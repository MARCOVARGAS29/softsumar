import { execSync } from 'child_process';

function getGitUser() {
  try {
    return execSync('git config user.name').toString().trim();
  } catch (error) {
    console.error('Error getting Git user name:', error.message);
    return 'unknown_user';
  }
}

function getRepoName() {
  try {
    const remoteUrl = execSync('git remote get-url origin').toString().trim();
    // Extracts 'repo-name' from URLs like:
    // https://github.com/user/repo-name.git
    // git@github.com:user/repo-name.git
    const repoNameMatch = remoteUrl.match(/[:/]([^/]+\/[^/]+)\.git$/);
    if (repoNameMatch && repoNameMatch[1]) {
      // We are interested in the repo name, not the user/repo
      const parts = repoNameMatch[1].split('/');
      return parts[1];
    }
    return 'unknown_repo';
  } catch (error) {
    console.error('Error getting Git repository name:', error.message);
    // This can happen if there is no remote named 'origin'
    return 'unknown_repo';
  }
}

const gitUtils = {
    getGitUser,
    getRepoName,
};


export default gitUtils;
