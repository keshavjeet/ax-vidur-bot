# Push this repo to your GitHub account

Git is initialized and the first commit is done. To put the code on GitHub:

## 1. Create the repository on GitHub

- Go to [github.com/new](https://github.com/new).
- **Repository name:** `ax-vidur-bot` (or any name you prefer).
- Choose **Public** or **Private**.
- Do **not** add a README, .gitignore, or license (this repo already has them).
- Click **Create repository**.

## 2. Add the remote and push

In PowerShell, from the `ax-vidur-bot` folder:

```powershell
# Replace YOUR_USERNAME with your GitHub username
git remote add origin https://github.com/YOUR_USERNAME/ax-vidur-bot.git

# Push (use main if your default branch is main)
git branch -M main
git push -u origin main
```

If your GitHub default branch is `master`, use instead:

```powershell
git remote add origin https://github.com/YOUR_USERNAME/ax-vidur-bot.git
git push -u origin master
```

## 3. Optional: set your Git identity

If you see “Author identity unknown” on this machine, set your name and email (use your GitHub email or the no-reply one):

```powershell
git config --global user.name "Your Name"
git config --global user.email "your-email@example.com"
```

For HTTPS push, GitHub will prompt for credentials (username + Personal Access Token, or use GitHub CLI `gh auth login`).
