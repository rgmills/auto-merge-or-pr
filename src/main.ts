import * as core from '@actions/core';
import * as github from '@actions/github';
import Octokit = require('@octokit/rest');

const delay = ms => new Promise(res => setTimeout(res, ms));

function logError(error: any) {
  core.debug(JSON.stringify(error));
  core.error(error.message);
}

function logInfo(messages: string[]) {
  core.info('');
  messages.forEach(message => {
    core.info(message);
  });
  core.info('');
}

async function tryMergeAsync(octokit: github.GitHub, baseBranch: string, headBranch: string, commit_message: string, allowDelay: boolean = false) {
  const context = github.context;
  try {
    await octokit.repos.merge({
      base: baseBranch,
      head: headBranch,
      commit_message,
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

    if (message.indexOf('Required status') > -1 && !!allowDelay) {
      for (let i = 0; i < 30; i++) {
        await delay(1000 * 60 * 30);
        
        const mergeResult = tryMergeAsync(octokit, baseBranch, headBranch, commit_message, false);
        if (!!mergeResult) {
          return true;
        }
      }
    }

    return true;
  }
}

async function createPrAsync(octokit: github.GitHub, baseBranch: string, headBranch: string, prTitle: string) {
  const context = github.context;

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

  return createdPr;
}

async function branchExistsAsync(octokit: github.GitHub, branch: string) {
  const context = github.context;

  try {
    await octokit.repos.getBranch({
      branch,
      ...context.repo
    });

    return true;
  } catch {
    return false;
  }
}

async function run() {
  const context = github.context;
  const githubToken = core.getInput('GITHUB_TOKEN');
  const baseBranch = core.getInput('BASE_BRANCH');

  let headBranch = core.getInput('HEAD_BRANCH');
  let prTitle = core.getInput('PULL_REQUEST_TITLE');
  let commitMessage = core.getInput('COMMIT_MESSAGE');
  let waitForChecks = core.getInput('WAIT_FOR_REQUIRED_CHECKS') === 'true';

  if (!headBranch && headBranch.length === 0) {
    let branchName = github.context.ref;
    if (branchName.indexOf('/refs/heads/') > -1) {
      branchName = branchName.slice('/refs/heads/'.length);
    }

    headBranch = branchName;
  }

  const headConflictsBranch = `conflicts-${headBranch}`;

  try {
    if (!prTitle || prTitle.length === 0) {
      prTitle = `[Bot] Automatic PR from ${headBranch} => ${baseBranch}`;
    }

    if (!commitMessage) {
      commitMessage = prTitle;
    }

    const octokit = new github.GitHub(githubToken);

    core.info(`loading "${headBranch}"`);
    const headBranchMetadata = await octokit.repos.getBranch({
      owner: context.repo.owner,
      repo: context.repo.repo,
      branch: headBranch
    });

    core.info(`loading "${baseBranch}"`);
    const baseBranchMetadata = await octokit.repos.getBranch({
      owner: context.repo.owner,
      repo: context.repo.repo,
      branch: baseBranch
    });

    if (headBranchMetadata.data.commit.sha === baseBranchMetadata.data.commit.sha) {
      core.info('source and target branches are in sync, skipping PR.');
      return;
    }

    const result = await tryMergeAsync(octokit, baseBranch, headBranch, commitMessage, !!waitForChecks);
    if (!!result) {
      return;
    }

    // We're here because there were conflicts with the merge.
    const branchExists = await branchExistsAsync(octokit, headConflictsBranch);

    // If the conflicts branch already exists, try to update the ref.  If that fails, try to merge.
    if (!!branchExists) {
      try {
        logInfo([
          `Attempting to update ref: ${headConflictsBranch}`,
          `                with sha: ${headBranchMetadata.data.commit.sha}`
        ]);

        await octokit.git.updateRef({
          ref: `refs/heads/${headConflictsBranch}`,
          sha: headBranchMetadata.data.commit.sha,
          ...context.repo
        });
      } catch (error) {
        logError(error);

        logInfo([
          `Unable to update ref for ${headConflictsBranch}`,
          `Trying to merge...`
        ]);

        const mergeResult = await tryMergeAsync(octokit, headConflictsBranch, headBranch, `Automatic merge from '${headBranch}'`, !!waitForChecks);

        if (!mergeResult) {
          try {
            await createPrAsync(octokit, headBranch, headConflictsBranch, prTitle);
            return;
          } catch (error) {
            logError(error);
            core.error(`Failed to create a PR for ${headBranch} => ${headConflictsBranch}`);
          }
        }
      }
    } else {
      // Create a new branch based on HEAD to allow conflicts to be resolved without having to modify HEAD itself.
      logInfo([`Creating a new branch ${headConflictsBranch}...`]);

      await octokit.git.createRef({
        ref: `refs/heads/${headConflictsBranch}`,
        sha: headBranchMetadata.data.commit.sha,
        ...context.repo
      });
    }

    // At this point, all we care about is trying to create a PR for conflicts branch into base
    const existingPulls = await octokit.pulls.list({
      owner: context.repo.owner,
      repo: context.repo.repo,
      state: 'open',
      base: baseBranch,
      head: `${context.repo.owner}:${headConflictsBranch}`
    });

    core.debug(JSON.stringify(existingPulls));

    if (existingPulls.data.length > 0) {
      const existingPull = existingPulls.data.find(x => x.head.ref === headConflictsBranch && x.base.ref === baseBranch);
      if (!!existingPull) {
        core.info(`Found an existing open pull request ${existingPull.html_url}, cancelling.`);

        return;
      }
    }

    await createPrAsync(octokit, baseBranch, headConflictsBranch, prTitle);
  } catch (error) {
    logError(error);

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