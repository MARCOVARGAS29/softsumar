import axios from 'axios';
import API_CONFIG from './apiConfig.js';
import gitUtils from './gitUtils.js';

const { BASE_URL } = API_CONFIG;
const { getGitUser, getRepoName } = gitUtils;

/**
 * Sends commit data to the backend.
 * @param {object} commitData The commit data to send.
 */
async function sendCommit(commitData) {
  try {
    const userId = getGitUser();
    const repoName = getRepoName();

    const payload = {
      ...commitData,
      user_id: userId,
      repo_name: repoName,
    };

    console.log('Sending data to /commits endpoint...');
    await axios.post(`${BASE_URL}/commits`, payload);
    console.log('Successfully sent commit data.');
  } catch (error) {
    console.error('Error sending commit data to backend:', error.message);
    // We log the error but don't re-throw, so the local script execution can continue.
  }
}

/**
 * Sends a batch of test run data to the backend.
 * @param {object} batchData The batch data containing commit_sha and an array of runs.
 */
async function sendTestRuns(batchData) {
  try {
    const userId = getGitUser();
    const repoName = getRepoName();

    const payload = {
      ...batchData,
      user_id: userId,
      repo_name: repoName,
    };

    console.log('Sending test runs batch to /test-runs endpoint...');
    await axios.post(`${BASE_URL}/test-runs`, payload);
    console.log('Successfully sent test runs batch.');
  } catch (error) {
    console.error('Error sending test runs batch to backend:', error.message);
  }
}

const apiClient = {
    sendCommit,
    sendTestRuns,
};


export default apiClient;
