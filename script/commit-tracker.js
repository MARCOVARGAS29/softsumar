import fs from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { tmpdir } from 'os';
import apiClient from './apiClient.js';
import { getBranchName } from './branch-utils.js';

const TEMP_TDD_LOG_FILE = path.join(tmpdir(), 'tdd_temp_log.json');
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
    const parentRef = execSync(`git log -1 --pretty=%P ${gitSha}`).toString().trim().split(' ')[0] || '4b825dc642cb6eb9a060e54bf8d69288fbee4904'; // Fallback to empty tree
    const diffStats = execSync(`git diff --stat ${parentRef} ${gitSha}`).toString();
    const additionsMatch = diffStats.match(/(\d+)\s+insertions?\(/);
    const deletionsMatch = diffStats.match(/(\d+)\s+deletions?\(/);
    additions = additionsMatch ? parseInt(additionsMatch[1], 10) : 0;
    deletions = deletionsMatch ? parseInt(deletionsMatch[1], 10) : 0;
  } catch (error) {
    // Fallback for first commit
      try {
        const diffStats = execSync(`git show --stat ${gitSha}`).toString();
        const additionsMatch = diffStats.match(/(\d+)\s+insertions?\(/);
        additions = additionsMatch ? parseInt(additionsMatch[1], 10) : 0;
        deletions = 0;
      } catch (innerError) {
          console.warn(`Could not calculate diff stats for ${gitSha}:`, innerError.message);
      }
  }

  // --- Logic to get TDD data from the temporary log file ---
  let tddData = { test_count: 0, failed_tests: 0, conclusion: 'neutral', coverage: 0, relevantTestRuns: [] };
  if (fs.existsSync(TEMP_TDD_LOG_FILE)) {
    const relevantTestRuns = JSON.parse(fs.readFileSync(TEMP_TDD_LOG_FILE, 'utf8'));
    
    if (relevantTestRuns.length > 0) {
      const lastTestRun = relevantTestRuns[relevantTestRuns.length - 1];
      tddData.test_count = lastTestRun.numTotalTests || 0;
      tddData.failed_tests = lastTestRun.failedTests || 0;
      tddData.conclusion = tddData.test_count > 0 ? (tddData.failed_tests > 0 ? 'failure' : 'success') : 'neutral';
    }
    // Note: Coverage is not available, so it defaults to 0.
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

// --- Main Execution ---
try {
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

    // 2. Send test runs to backend in a batch
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
    
    console.log('Commit data sent to backend successfully.');
  }
} catch (error) {
  console.error('Error in commit tracking script:', error);
  process.exit(1);
} finally {
    // 3. Clean up the temporary file
    if (fs.existsSync(TEMP_TDD_LOG_FILE)) {
        try {
            fs.unlinkSync(TEMP_TDD_LOG_FILE);
            console.log('Temporary TDD log file deleted.');
        } catch (cleanupError) {
            console.error('Error deleting temporary TDD log file:', cleanupError);
        }
    }
}
