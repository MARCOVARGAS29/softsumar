import fs from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import apiClient from './apiClient.js';
import { getBranchName } from './branch-utils.js';

const COMMIT_HISTORY_FILE = 'script/commit-history.json';
const TDD_LOG_FILE = 'script/tdd_log.json';
const HEAD_MARKER = 'HEAD';

function getCommitInfo(sha) {
  let commitMessage, commitDate, author;
  const isHeadCommit = sha === HEAD_MARKER;
  const gitSha = isHeadCommit ? 'HEAD' : sha;

  try {
    commitMessage = execSync(`git log -1 --pretty=%B ${gitSha}`).toString().trim();
    commitDate = new Date(execSync(`git log -1 --format=%cd ${gitSha}`).toString()).toISOString();
    author = execSync(`git log -1 --pretty=format:%an ${gitSha}`).toString().trim();
  } catch (error) {
    console.error(`Error getting basic commit info for ${gitSha}:`, error);
    return null;
  }

  let repoUrl = '';
  try {
    repoUrl = execSync('git config --get remote.origin.url').toString().trim().replace(/\.git$/, '');
    if (repoUrl.startsWith('git@')) {
      repoUrl = repoUrl.replace(/^git@([^:]+):(.+)$/, 'https://$1/$2');
    }
  } catch {
    console.warn('Could not find remote.origin.url. Commit URL will be incomplete.');
  }

  const commitUrl = isHeadCommit ? `${repoUrl}/commit/HEAD` : `${repoUrl}/commit/${sha}`;
  
  // Stats calculation
  let additions = 0, deletions = 0;
  try {
    const parentRef = execSync(`git log -1 --pretty=%P ${gitSha}`).toString().trim().split(' ')[0] || '4b825dc642cb6eb9a060e54bf8d69288fbee4904'; // Fallback to empty tree for first commit
    const diffStats = execSync(`git diff --stat ${parentRef} ${gitSha} -- ":(exclude)${COMMIT_HISTORY_FILE}" ":(exclude)${TDD_LOG_FILE}"`).toString();
    const additionsMatch = diffStats.match(/(\d+)\s+insertions?\(/);
    const deletionsMatch = diffStats.match(/(\d+)\s+deletions?\(/);
    additions = additionsMatch ? parseInt(additionsMatch[1], 10) : 0;
    deletions = deletionsMatch ? parseInt(deletionsMatch[1], 10) : 0;
  } catch (error) {
    console.warn(`Could not calculate diff stats for ${gitSha}. It might be the first commit.`, error.message);
      try {
        const diffStats = execSync(`git show --stat ${gitSha} -- ":(exclude)${COMMIT_HISTORY_FILE}" ":(exclude)${TDD_LOG_FILE}"`).toString();
        const additionsMatch = diffStats.match(/(\d+)\s+insertions?\(/);
        additions = additionsMatch ? parseInt(additionsMatch[1], 10) : 0;
        deletions = 0;
      } catch (innerError) {
          console.warn(`Error getting stats for the first commit:`, innerError.message);
      }
  }

  // --- Logic to get TDD data from tdd_log.json ---
  let tddData = { test_count: 0, failed_tests: 0, conclusion: 'neutral', coverage: 0, relevantTestRuns: [] };
  if (fs.existsSync(TDD_LOG_FILE)) {
    const tddLog = JSON.parse(fs.readFileSync(TDD_LOG_FILE, 'utf8'));
    
    // Find the index of the last commit marker before the current 'HEAD' marker
    const headMarkerIndex = tddLog.findIndex(e => e.commitId === 'HEAD');
    let lastCommitIndex = -1;
    for (let i = headMarkerIndex - 1; i >= 0; i--) {
      if (tddLog[i].commitId) {
        lastCommitIndex = i;
        break;
      }
    }
    
    const relevantEntries = tddLog.slice(lastCommitIndex + 1, headMarkerIndex);
    const relevantTestRuns = relevantEntries.filter(e => !e.commitId);
    
    if (relevantTestRuns.length > 0) {
      const lastTestRun = relevantTestRuns[relevantTestRuns.length - 1];
      tddData.test_count = lastTestRun.numTotalTests || 0;
      tddData.failed_tests = lastTestRun.failedTests || 0;
      tddData.conclusion = tddData.test_count > 0 ? (tddData.failed_tests > 0 ? 'failure' : 'success') : 'neutral';
    }
    // Note: Coverage is not available in tdd_log.json, so it defaults to 0.
    tddData.relevantTestRuns = relevantTestRuns;
  }
  // --- End of TDD data logic ---

  return {
    sha: isHeadCommit ? HEAD_MARKER : sha,
    author,
    commit: { date: commitDate, message: commitMessage, url: commitUrl },
    stats: { total: additions + deletions, additions, deletions, date: commitDate.split('T')[0] },
    coverage: tddData.coverage,
    test_count: tddData.test_count,
    failed_tests: tddData.failed_tests,
    conclusion: tddData.conclusion,
    __relevantTestRuns: tddData.relevantTestRuns, // Internal use, to pass to sender logic
  };
}

function saveCommitData(commitData) {
  let commits = [];
  if (fs.existsSync(COMMIT_HISTORY_FILE)) {
    try {
      commits = JSON.parse(fs.readFileSync(COMMIT_HISTORY_FILE, 'utf8'));
    } catch (error) {
      console.error('Error reading commit history file:', error);
      commits = [];
    }
  }

  const headIndex = commits.findIndex((c) => c.sha === HEAD_MARKER);
  if (headIndex !== -1) {
    const lastCommitSha = execSync('git rev-parse HEAD~1').toString().trim();
    const oldHead = commits[headIndex];
    oldHead.sha = lastCommitSha;
    if (oldHead.commit.url) {
      oldHead.commit.url = oldHead.commit.url.replace('/commit/HEAD', `/commit/${lastCommitSha}`);
    }
  }

  const existingIndex = commits.findIndex(c => c.sha === HEAD_MARKER);
  if (existingIndex !== -1) {
    commits.splice(existingIndex, 1); // Remove previous HEAD before adding the new one
  }
  
  // Clean up internal data before saving
  const dataToSave = { ...commitData };
  delete dataToSave.__relevantTestRuns;
  commits.push(dataToSave);
  
  commits.sort((a, b) => new Date(a.commit.date) - new Date(b.commit.date));
  fs.writeFileSync(COMMIT_HISTORY_FILE, JSON.stringify(commits, null, 2));
}

// --- Main Execution ---
try {
  if (!fs.existsSync(COMMIT_HISTORY_FILE)) {
    fs.writeFileSync(COMMIT_HISTORY_FILE, '[]', 'utf-8');
  }

  const currentCommitData = getCommitInfo(HEAD_MARKER);
  
  if (currentCommitData) {
    const currentSha = execSync('git rev-parse HEAD').toString().trim();
    const branchName = getBranchName();

    // 1. Send aggregated commit data to backend
    const commitPayload = {
      _id: currentSha,
      branch: branchName,
      author: currentCommitData.author,
      commit: currentCommitData.commit,
      stats: currentCommitData.stats,
      coverage: currentCommitData.coverage,
      test_count: currentCommitData.test_count,
      failed_tests: currentCommitData.failed_tests,
      conclusion: currentCommitData.conclusion,
    };
    // The URL in the payload needs to be corrected from HEAD to the actual SHA
    commitPayload.commit.url = commitPayload.commit.url.replace('/commit/HEAD', `/commit/${currentSha}`);
    apiClient.sendCommit(commitPayload);

    // 2. Send individual test runs to backend in a batch
    if (currentCommitData.__relevantTestRuns && currentCommitData.__relevantTestRuns.length > 0) {
      const runs = currentCommitData.__relevantTestRuns.map(run => ({
        execution_timestamp: run.timestamp,
        summary: {
          passed: run.numPassedTests,
          failed: run.failedTests,
          total: run.numTotalTests,
        },
        success: run.success,
        test_id: run.testId,
      }));

      const testRunsPayload = {
        commit_sha: currentSha,
        branch: branchName,
        runs: runs,
      };
      
      apiClient.sendTestRuns(testRunsPayload);
    }

    // 3. Save data locally
    saveCommitData(currentCommitData);
    console.log('Commit tracker executed successfully.');
  }
} catch (error) {
  console.error('Error in commit tracking script:', error);
  process.exit(1);
}
