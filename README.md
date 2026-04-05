# renpy-build-action

Build a [Ren'Py](https://www.renpy.org/) project in GitHub Actions.

See the Ren'Py docs for [building distributions](https://www.renpy.org/doc/html/build.html), [Android packaging](https://www.renpy.org/doc/html/android.html), and [Web / HTML5 builds](https://www.renpy.org/doc/html/web.html).

## Usage

```yaml
name: Build Ren'Py project

on:
  push:
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Build
        id: build
        uses: MightyElemental/renpy-build-action@master
        with:
          sdk-version: 8.5.2
          project-dir: .
          targets: pc

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: game-${{ steps.build.outputs.version }}
          path: ./dist
```

## Inputs

| Input | Default | Notes |
|---|---|---|
| `sdk-version` | `8.5.2` | Ren'Py SDK version to use. |
| `project-dir` | `.` | Path to the Ren'Py project directory. |
| `targets` | `pc` | Whitespace-separated targets, for example `pc`, `win mac linux`, `web`, or `android`. |
| `output-dir` | `./dist` | Output directory for built files. |
| `renpy-steam` | `false` | Installs the Ren'Py Steam library before building. |
| `python-requirements` | `""` | Path to the pip requirements file. |
| `python-lib-install-path` | `""` | Path to installation folder for 3rd party Python packages. |

## Output

| Output | Description |
|---|---|
| `version` | The detected project version. |

## Targets

Supported targets:

- `pc`
- `win`
- `mac`
- `linux`
- `web`
- `android`

For normal desktop builds, Ren'Py's distribution tooling is used. For `web`, the action runs Ren'Py's web build flow. For `android`, it runs Ren'Py's Android build flow.

## Examples

### Desktop builds

```yaml
- name: Build Windows, macOS, and Linux
  uses: MightyElemental/renpy-build-action@master
  with:
    sdk-version: 8.5.2
    project-dir: .
    targets: win mac linux
```

### Web build

```yaml
- name: Build Web
  uses: MightyElemental/renpy-build-action@master
  with:
    sdk-version: 8.5.2
    project-dir: .
    targets: web
```

After building for web, upload the generated web package to your host. Ren'Py's web build docs explain the generated files and hosting requirements, including `.wasm` MIME types and `web.zip` uploads to services like itch.io.

### Android build

This action can run Ren'Py's Android build step, but Android builds need extra setup first.

Typical requirements:

- A JDK installed. Ren'Py's Android docs say JDK 21 is required.
- An Android SDK installed and available to RAPT.
- Android signing keys such as `android.keystore`.
- A project that has already been configured for Android.

A practical workflow looks like this:

```yaml
jobs:
  build:
    # Build multiple target groups on different runners.
    strategy:
      fail-fast: false
      matrix:
        include:
          # Linux runner builds Linux, Android, and Web packages.
          - os: ubuntu-latest
            packages: linux android web

          # Windows runner builds the Windows package.
          - os: windows-latest
            packages: win

          # macOS runner builds the macOS package.
          - os: macos-latest
            packages: mac

    # Run each matrix entry on its selected operating system.
    runs-on: ${{ matrix.os }}

    env:
      # Path to the Ren'Py project directory.
      GAME_SRC: src

      # Location where extra Python packages will be vendored
      # so Ren'Py can include them in the build.
      PYTHON_PACKAGES_DIR: src/game/python-packages

    steps:
      # Check out the repository contents so the workflow can build the game.
      - uses: actions/checkout@v4

      # For Android builds on Linux, write the signing keystore from a base64
      # encoded GitHub secret into the project directory.
      - name: Write Android keystore from secret
        if: runner.os == 'Linux' && contains(matrix.packages, 'android')
        shell: bash
        run: |
          echo "${{ secrets.ANDROID_KEYSTORE_BASE64 }}" | base64 -d > "${{ env.GAME_SRC }}/android.keystore"
          chmod 600 "${{ env.GAME_SRC }}/android.keystore"

      # Android builds require Java, so install a JDK when building Android.
      - name: Set up JDK
        if: runner.os == 'Linux' && contains(matrix.packages, 'android')
        uses: actions/setup-java@v5
        with:
          java-version: '21'
          distribution: 'temurin'

      # Install the Android SDK for Android packaging.
      # The action does not handle SDK installation itself.
      - name: Setup Android SDK
        if: runner.os == 'Linux' && contains(matrix.packages, 'android')
        uses: android-actions/setup-android@v4
        with:
          log-accepted-android-sdk-licenses: "false"

      # Set up Python so we can install any extra Python dependencies needed
      # by the game before packaging.
      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      # Install Python dependencies into the game's python-packages directory
      # so they are bundled with the Ren'Py project.
      - name: Vendor Python dependencies
        shell: bash
        run: |
          mkdir -p "${{ env.PYTHON_PACKAGES_DIR }}"
          python -m pip install --upgrade pip
          python -m pip install --target "${{ env.PYTHON_PACKAGES_DIR }}" -r requirements.txt

      # Run the Ren'Py build action.
      # - sdk-version selects which Ren'Py SDK to download/use.
      # - project-dir points to the Ren'Py project.
      # - targets chooses which distributions to build for this runner.
      #
      # SDL dummy drivers help avoid audio/video device issues in CI.
      - name: Build
        id: build
        uses: MightyElemental/renpy-build-action@master
        with:
          sdk-version: 8.5.2
          project-dir: ${{ env.GAME_SRC }}
          targets: ${{ matrix.packages }}
        env:
          SDL_AUDIODRIVER: dummy
          SDL_VIDEODRIVER: dummy

      # Upload the generated dist directory as a workflow artifact so the
      # packaged builds can be downloaded from the Actions run.
      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: game-${{ steps.build.outputs.version }}-${{ runner.os }}
          path: ./dist
```

Notes for Android:

- Put your keystore where Ren'Py expects it for the project.
- Make sure your Android project settings have already been configured in Ren'Py.
- If you vendor Python packages into the game, place them somewhere included by your build, such as `game/python-packages`.
- Running Android builds on Linux is the simplest option for CI.

## Notes

- `targets` must be whitespace-separated, not comma-separated.
- The action also installs Ren'Py's web support automatically when `web` is requested.
- If `old-game/` exists and is empty, the action fails.
- The repository currently has no tagged releases, so examples use `@master`.

## TODO

Declared in `action.yml`, but not implemented in the action code yet:

- `python-requirements`
- `python-lib-install-path`

These will be used to replace the `Vendor Python dependencies` step in the above example.

## License

MIT
