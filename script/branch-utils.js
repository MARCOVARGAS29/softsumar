import { execSync } from 'child_process';

/**
 * Gets the current Git branch name.
 * @returns {string} The current branch name.
 */
function getBranchName() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
  } catch (error) {
    console.error('Error getting Git branch name:', error.message);
    return 'unknown_branch';
  }
}

export { getBranchName };
