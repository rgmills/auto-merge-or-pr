# Auto Merge Or PR

Intended to deliver changes from a prescibed `HEAD` branch into a `BASE` branch.  This is typically used when you may have a `release` branch and a `dev` or `master` branch for active development, but this action may no assumption about the semantics of `HEAD` and `BASE`.

In case of conflicts, this action attempts to create a branch `conflicts-[HEAD]`.  This allows you to address any conflicts without accidentally pulling `BASE` into `HEAD` to resolve which is usually undesireable.

If `conflicts-[HEAD]` already exists, a fast-forward is attempted.  Then, a merge of `HEAD` => `conflicts-[HEAD]`.  As a fallback, a PR will be will be created.

If `conflicts-[HEAD]` does not exist, a PR will be created `conflicts-[HEAD]` => `[BASE]`.

## Usage

Below is an example configuration:

```yaml
name: Release to Master

on:
  push:
    branches:
      - release

jobs:
  build:
    runs-on: ubuntu-latest    
    steps:
    - uses: rgmills/auto-merge-or-pr@v0.1.2
      with:
        GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}'
        BASE_BRANCH: 'master'
        HEAD_BRANCH: 'release'
```

If you track releases in their own branches such as `release/3.2` then you can omit `HEAD_BRANCH` and the branch that triggered the event will be used.

```yaml
name: Release to Master

on:
  push:
    branches:
      - release/*

jobs:
  build:
    runs-on: ubuntu-latest    
    steps:
    - uses: rgmills/auto-merge-or-pr@v0.1.2
      with:
        GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}'
        BASE_BRANCH: 'master'
```

## Development

- Requires yarn
- Run `yarn dev`
- `master` is the base branch

## Releasing

- Actions are required to be self-contained, therefore `node_modules` must be checked in.
- Since, the action only requires a subset of packages (from `dependencies`) there are some special requirements to do a release.
- Create a branch off of `master`, currently following the pattern `release/vx.x.x`.
- Run `yarn release`.  This will ensure it's built and then `node_modules` is trimmed to what's required to run.
- Run `git add node_modules -f`
