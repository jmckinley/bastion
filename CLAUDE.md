# Bastion site

Marketing/site repo for Bastion. Deployed by scp to the VPS (`/srv/bastionplane/`),
not git-push auto-deploy.

## New-machine setup (dev environment portability)

On a NEW machine, before working here, restore the portable dev environment (after
`gh auth login`):

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/jmckinley/dotfiles/main/bootstrap.sh)
```

It symlinks the global Claude config (`~/.claude/CLAUDE.md`) and clones the Content
Studio video toolkit (`~/content-studio`), the default tool for any demo/marketing/
explainer video in any repo. If `jmckinley/dotfiles` is private, instead run:
`git clone git@github.com:jmckinley/dotfiles.git ~/dotfiles && ~/dotfiles/bootstrap.sh`.
