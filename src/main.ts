import * as core from '@actions/core';
import * as github from '@actions/github';
import Octokit = require('@octokit/rest');

async function tryMergeAsync(octokit: github.GitHub, baseBranch: string, headBranch: string) {
  const context = github.context;
  try {
    await octokit.repos.merge({
      base: baseBranch,
      head: headBranch,
      ...context.repo
    });

    core.info('Successfully merged without conflicts');

    return true;
  } catch (error) {
    const message: string = error.message;
    core.info('Failed to merge: ' + message);
    if (message === 'Merge Conflict') {
      return false;
    }

    return true;
  }
}

async function run() {
  const context = github.context;
  const githubToken = core.getInput('GITHUB_TOKEN');
  const baseBranch = core.getInput('BASE_BRANCH');
  let headBranch = core.getInput('HEAD_BRANCH');
  let prTitle = core.getInput('PULL_REQUEST_TITLE');

  if (!headBranch && headBranch.length === 0) {
    let branchName = github.context.ref;
    if (branchName.indexOf('/refs/heads/') > -1) {
      branchName = branchName.slice('/refs/heads/'.length);
    }

    headBranch = branchName;
  }

  try {
    if (!prTitle || prTitle.length === 0) {
      prTitle = `[Bot] Automatic PR from ${headBranch} => ${baseBranch}`;
    }

    const octokit = new github.GitHub(githubToken);

    core.debug(`loading "${headBranch}"`);
    const headBranchMetadata = await octokit.repos.getBranch({
      owner: context.repo.owner,
      repo: context.repo.repo,
      branch: headBranch
    });

    core.debug(`loading "${baseBranch}"`);
    const baseBranchMetadata = await octokit.repos.getBranch({
      owner: context.repo.owner,
      repo: context.repo.repo,
      branch: baseBranch
    });

    if (headBranchMetadata.data.commit.sha === baseBranchMetadata.data.commit.sha) {
      core.info('source and target branches are in sync, skipping PR.');
      return;
    }

    const result = await tryMergeAsync(octokit, baseBranch, headBranch);
    if (!!result) {
      return;
    }

    const existingPulls = await octokit.pulls.list({
      owner: context.repo.owner,
      repo: context.repo.repo,
      state: 'open',
      base: baseBranch,
      head: `${context.repo.owner}:${headBranch}`
    });

    core.debug(JSON.stringify(existingPulls));

    if (existingPulls.data.length > 0) {
      const existingPull = existingPulls.data.find(x => x.head.ref === headBranch && x.base.ref === baseBranch);
      if (!!existingPull) {
        core.info(`Found an existing open pull request ${existingPull.html_url}, cancelling.`);
        return;
      }
    }

    const pr: Octokit.PullsCreateParams = {
      base: baseBranch,
      body: 'Automatic PR',
      head: headBranch,
      owner: context.repo.owner,
      repo: context.repo.repo,
      title: prTitle
    };

    const createdPr = await octokit.pulls.create(pr);

    core.info(`Created a new PR: ${createdPr.data.html_url}`);
  } catch (error) {
    core.debug(JSON.stringify(error));
    const messageString = error.message as string;
    if (!!messageString) {
      if (messageString.indexOf('pull request already exists') >= 0) {
        core.info('Found an existing open pull request, cancelling.');
        return;
      }

      if (messageString.indexOf('No commits between') >= 0) {
        core.info(`${baseBranch} already has all commits in ${headBranch}`);
        return;
      }
    }


    core.setFailed(error.message);
  }
}

run();