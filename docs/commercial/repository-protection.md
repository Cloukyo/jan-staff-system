# Commercial Repository Protection Recommendations

These settings must be applied through GitHub rulesets by a repository administrator after the commercial release branch and separate commercial deployment environments exist. This workstream does not change repository settings.

## Commercial release branch ruleset

Apply the ruleset to the future commercial release branch, not Jan's current `main`, until the repositories or release lines are formally separated.

Recommended rules:

- require pull requests;
- require two approvals for migrations, authentication, permissions, security, release and dependency changes;
- require CODEOWNERS review;
- dismiss stale approvals after new commits;
- require approval from someone other than the last pusher;
- require all review conversations to be resolved;
- block force pushes and branch deletion;
- require linear history;
- restrict direct pushes to the release automation identity;
- require signed commits where every contributor and automation path supports them;
- prevent administrators from bypassing without an audited emergency reason; and
- require the branch to be current before merge.

Required status checks:

- `Lint, typecheck, test and build`
- `Apply and test every migration`
- `Dependency audit`
- `Dependency change review`
- `Secret scan`
- `Analyse JavaScript and TypeScript`

## Sensitive-path ownership

The committed CODEOWNERS file assigns all paths to `@Cloukyo` and explicitly lists security-sensitive surfaces. Before the engineering team grows, replace the single owner on sensitive paths with least-privilege teams such as commercial-security, database-reviewers and release-managers.

## GitHub security settings

Enable through repository or organisation policy:

- GitHub secret scanning and push protection;
- validity checks for supported token types;
- Dependabot alerts and security updates;
- private vulnerability reporting;
- CodeQL default or advanced setup, but not both simultaneously;
- Actions limited to GitHub-authored and explicitly approved third-party actions;
- default workflow token permissions set to read-only; and
- approval for workflows introduced by first-time external contributors.

The repository workflows independently scan secrets and dependencies. Native GitHub protection remains necessary because push protection can stop a secret before it enters history.

## Deployment environment rules

Create `commercial-staging` and `commercial-production` GitHub environments with separate secrets. Production should require at least two reviewers, prevent self-review, restrict branches and use a wait timer appropriate to the support model.

Commercial and Jan credentials must never share a secret name, Vercel project, Supabase project or GitHub environment. Audit environment access quarterly and after personnel changes.

## Tags and releases

- Protect release tags matching `commercial-v*`.
- Create tags only from the verified commercial release branch.
- Record the immutable staging deployment URL and SHA in release notes.
- Do not publish a release when any required security finding is unresolved.
- Retain the previous healthy deployment for application rollback.
