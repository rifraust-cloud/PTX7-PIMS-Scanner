# Phone-only deployment using GitHub Actions

You do not need Android Studio or a computer.

## What you need
- Your Samsung phone
- A free GitHub account
- The ZIP file for this project

## Part 1 — Create the GitHub repository
1. Open https://github.com in Chrome on your Samsung.
2. Sign in.
3. Tap your profile menu, then **Your repositories**.
4. Tap **New**.
5. Repository name: `PTX7-PIMS-Scanner`
6. Choose **Private**.
7. Tap **Create repository**.

## Part 2 — Upload the project files
GitHub's mobile website does not reliably upload a whole folder directly.

Recommended phone-only method:
1. Install the official **GitHub** app if you do not already have it.
2. In Chrome, open your new repository.
3. Use **Add file > Upload files**.
4. Upload the project files while preserving the folder structure if your browser allows it.

Because preserving folders on a phone can be awkward, an easier method is to use a Git client app that can import a ZIP or clone a repository and upload folders.

If GitHub's web upload gives you trouble, use one of these:
- Termux
- GitJournal / another Git client that supports folder commits
- A cloud file manager with GitHub integration

The project must contain these top-level items in GitHub:
- `.github`
- `app`
- `build.gradle.kts`
- `gradle.properties`
- `settings.gradle.kts`

## Part 3 — Run the cloud build
After the files are uploaded:

1. Open the repository.
2. Tap **Actions**.
3. Select **Build Android APK**.
4. Tap **Run workflow**.
5. Tap the green **Run workflow** button.

GitHub will build the APK in the cloud.

## Part 4 — Download the APK
1. Wait for the workflow to show a green checkmark.
2. Open the completed workflow run.
3. Scroll to **Artifacts**.
4. Download:
   `PTX7-PIMS-Scanner-debug`
5. GitHub downloads the artifact as a ZIP.
6. Open the ZIP in Samsung **My Files**.
7. Extract:
   `app-debug.apk`

## Part 5 — Install on Samsung
1. Tap `app-debug.apk`.
2. If prompted, allow **Install unknown apps** for My Files or Chrome.
3. Return to the APK.
4. Tap **Install**.

## First test
1. Open **PTX7 PIMS Scanner**.
2. Tap **Scan**.
3. Scan a known location such as `MANFW0105H08`.
4. Confirm the exact location appears.
5. Test **Open PIMS** first.
6. After that, test **Integrated PIMS**.

## Security note
This prototype does not store Amazon credentials. The integrated browser mode may still be blocked by enterprise authentication policy. Standalone scan-and-copy mode should continue to work even if integrated login is blocked.
