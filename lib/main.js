"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const github = __importStar(require("@actions/github"));
function logError(error) {
    core.debug(JSON.stringify(error));
    core.error(error.message);
}
function logInfo(messages) {
    core.info('');
    messages.forEach(message => {
        core.info(message);
    });
    core.info('');
}
function tryMergeAsync(octokit, baseBranch, headBranch, commit_message) {
    return __awaiter(this, void 0, void 0, function* () {
        const context = github.context;
        try {
            yield octokit.repos.merge(Object.assign({ base: baseBranch, head: headBranch, commit_message }, context.repo));
            core.info('Successfully merged without conflicts');
            return true;
        }
        catch (error) {
            const message = error.message;
            core.info('Failed to merge: ' + message);
            if (message === 'Merge Conflict') {
                return false;
            }
            return true;
        }
    });
}
function createPrAsync(octokit, baseBranch, headBranch, prTitle) {
    return __awaiter(this, void 0, void 0, function* () {
        const context = github.context;
        const pr = {
            base: baseBranch,
            body: 'Automatic PR',
            head: headBranch,
            owner: context.repo.owner,
            repo: context.repo.repo,
            title: prTitle
        };
        const createdPr = yield octokit.pulls.create(pr);
        core.info(`Created a new PR: ${createdPr.data.html_url}`);
        return createdPr;
    });
}
function branchExistsAsync(octokit, branch) {
    return __awaiter(this, void 0, void 0, function* () {
        const context = github.context;
        try {
            yield octokit.repos.getBranch(Object.assign({ branch }, context.repo));
            return true;
        }
        catch (_a) {
            return false;
        }
    });
}
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        const context = github.context;
        const githubToken = core.getInput('GITHUB_TOKEN');
        const baseBranch = core.getInput('BASE_BRANCH');
        let headBranch = core.getInput('HEAD_BRANCH');
        let prTitle = core.getInput('PULL_REQUEST_TITLE');
        let commitMessage = core.getInput('COMMIT_MESSAGE');
        if (!headBranch && headBranch.length === 0) {
            let branchName = github.context.ref;
            if (branchName.indexOf('/refs/heads/') > -1) {
                branchName = branchName.slice('/refs/heads/'.length);
            }
            headBranch = branchName;
        }
        const headConflictsBranch = `${headBranch}-conflicts`;
        try {
            if (!prTitle || prTitle.length === 0) {
                prTitle = `[Bot] Automatic PR from ${headBranch} => ${baseBranch}`;
            }
            if (!commitMessage) {
                commitMessage = prTitle;
            }
            const octokit = new github.GitHub(githubToken);
            core.info(`loading "${headBranch}"`);
            const headBranchMetadata = yield octokit.repos.getBranch({
                owner: context.repo.owner,
                repo: context.repo.repo,
                branch: headBranch
            });
            core.info(`loading "${baseBranch}"`);
            const baseBranchMetadata = yield octokit.repos.getBranch({
                owner: context.repo.owner,
                repo: context.repo.repo,
                branch: baseBranch
            });
            if (headBranchMetadata.data.commit.sha === baseBranchMetadata.data.commit.sha) {
                core.info('source and target branches are in sync, skipping PR.');
                return;
            }
            const result = yield tryMergeAsync(octokit, baseBranch, headBranch, commitMessage);
            if (!!result) {
                return;
            }
            // We're here because there were conflicts with the merge.
            const branchExists = yield branchExistsAsync(octokit, headConflictsBranch);
            // If the conflicts branch already exists, try to update the ref.  If that fails, try to merge.
            if (!!branchExists) {
                try {
                    logInfo([
                        `Attempting to update ref: ${headConflictsBranch}`,
                        `                with sha: ${headBranchMetadata.data.commit.sha}`
                    ]);
                    yield octokit.git.updateRef(Object.assign({ ref: `refs/heads/${headConflictsBranch}`, sha: headBranchMetadata.data.commit.sha }, context.repo));
                }
                catch (error) {
                    logError(error);
                    logInfo([
                        `Unable to update ref for ${headConflictsBranch}`,
                        `Trying to merge...`
                    ]);
                    const mergeResult = yield tryMergeAsync(octokit, headConflictsBranch, headBranch, `Automatic merge from '${headBranch}'`);
                    if (!mergeResult) {
                        try {
                            yield createPrAsync(octokit, headBranch, headConflictsBranch, prTitle);
                        }
                        catch (error) {
                            logError(error);
                            core.error(`Failed to create a PR for ${headBranch} => ${headConflictsBranch}`);
                        }
                    }
                }
            }
            else {
                // Create a new branch based on HEAD to allow conflicts to be resolved without having to modify HEAD itself.
                logInfo([`Creating a new branch ${headConflictsBranch}...`]);
                yield octokit.git.createRef(Object.assign({ ref: `refs/heads/${headConflictsBranch}`, sha: headBranchMetadata.data.commit.sha }, context.repo));
            }
            // At this point, all we care about is trying to create a PR for conflicts branch into base
            const existingPulls = yield octokit.pulls.list({
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
            yield createPrAsync(octokit, baseBranch, headConflictsBranch, prTitle);
        }
        catch (error) {
            logError(error);
            const messageString = error.message;
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
    });
}
run();
