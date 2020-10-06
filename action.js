const core = require('@actions/core');
const axios = require('axios');

async function webrequest(url, method, payload, headers, username, password) {
  const auth = username && password ? { username, password } : null;
  const config = {
    url,
    method,
    auth,
    data: payload,
    headers
  };
  try {
    const response = await axios(config);
    return response;
  } catch (error) {
    console.error(error);
  }
}

async function main() {
  try {
    // inputs from action
    const url = core.getInput('url') || ("https://github.com/" + process.env.GITHUB_REPOSITORY);
    const method = "post";
    const payload = {"url": url};

    // current time
    const time = new Date().toTimeString();

    // http request to external API
    const response = await webrequest(
      url,
      method,
      payload,
    );

    const statusCode = response.status;
    const data = response.data;
    const outputObject = {
      url,
      method,
      payload,
      time,
      statusCode,
      data
    };

    const consoleOutputJSON = JSON.stringify(outputObject, undefined, 2);
    console.log(consoleOutputJSON);

    if (statusCode >= 400) {
      core.setFailed(`HTTP request failed with status code: ${statusCode}`);
    } else {
      const outputJSON = JSON.stringify(outputObject);
      core.setOutput('output', outputJSON);
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

main();
