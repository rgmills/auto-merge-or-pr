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
function run() {
    return __awaiter(this, void 0, void 0, function* () {
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
            const headBranchMetadata = yield octokit.repos.getBranch({
                owner: context.repo.owner,
                repo: context.repo.repo,
                branch: headBranch
            });
            core.debug(`loading "${baseBranch}"`);
            const baseBranchMetadata = yield octokit.repos.getBranch({
                owner: context.repo.owner,
                repo: context.repo.repo,
                branch: baseBranch
            });
            if (headBranchMetadata.data.commit.sha === baseBranchMetadata.data.commit.sha) {
                core.info('source and target branches are in sync, skipping PR.');
                return;
            }
            const existingPulls = yield octokit.pulls.list({
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
        }
        catch (error) {
            core.debug(JSON.stringify(error));
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
