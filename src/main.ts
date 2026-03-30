import * as core from "@actions/core";
import * as tc from "@actions/tool-cache";
import * as io from "@actions/io";
import * as exec from "@actions/exec";

import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

const isWindows = process.platform === "win32";
const renpyDir = path.resolve("..", "renpy");
const renpyExec = isWindows
  ? path.join(renpyDir, "lib", "py3-windows-x86_64", "python.exe")
  : path.join(renpyDir, "renpy.sh");
const renpyLauncher = path.join(renpyDir, "launcher");


function parseBool(v: string): boolean {
    return ["true", "1", "yes", "y", "on"].includes(v.trim().toLowerCase());
}


function parseTargets(targetsRaw: string): string[] {
    const t = (targetsRaw || "").trim();
    if (!t) return ["pc"];
    return t.split(/\s+/).filter(Boolean);
}


async function installRenpySdk(sdkVersion: string): Promise<void> {
    const sdkName = `renpy-${sdkVersion}-sdk`;
    const url = `https://www.renpy.org/dl/${sdkVersion}/${sdkName}.zip`;

    core.info(`Downloading the specified SDK (${sdkName})...`);
    const zipPath = await tc.downloadTool(url);

    core.info(`Setting up the specified SDK (${sdkName})...`);
    const extractRoot = await tc.extractZip(zipPath);

    // The extracted tar should contain a top-level folder named sdkName.
    const extractedSdkPath = path.join(extractRoot, sdkName);

    await io.mv(extractedSdkPath, renpyDir);

    core.info(`Setup SDK version (${sdkName}).`);
}


async function getProjectVersion(projectDir: string): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "renpy-json-"));
  const tmpPath = path.join(tmpDir, "dump.json");

  try {
    // Suppress stdout similar to >/dev/null by not streaming it into logs.
    await exec.exec(renpyExec, ["--json-dump", tmpPath, projectDir, "quit"], {
      silent: true,
    });

    const raw = await fs.readFile(tmpPath, "utf8");
    const data = JSON.parse(raw) as any;

    const version: string =
      (typeof data?.build?.version === "string" && data.build.version) ||
      (typeof data?.config?.version === "string" && data.config.version) ||
      "";

    return version;
  } finally {
    // Clean temp artifacts
    await io.rmRF(tmpDir);
  }
}


async function checkOldGame(projectDir: string): Promise<void> {
  const oldGameDir = path.join(projectDir, "old-game");

  try {
    const stat = await fs.stat(oldGameDir);
    if (!stat.isDirectory()) return;
  } catch {
    // Doesn't exist => OK
    return;
  }

  core.info("old-game directory detected.");

  const entries = await fs.readdir(oldGameDir);
  if (entries.length === 0) {
    throw new Error(
      [
        "ERROR: old-game is empty. This will cause incompatibility issues.",
        "For more information on how the old-game directory works and why",
        "this directory should not be empty, please refer to the documentation",
        "at: https://www.renpy.org/doc/html/build.html#old-game.",
      ].join("\n")
    );
  }
}


async function installLibrary(library: string, sdkVersion: string) {
    const fileName = `renpy-${sdkVersion}-${library}.zip`;

    core.info(`Downloading library '${library}' for Ren'Py SDK version ${sdkVersion}`);
    const zipPath = await tc.downloadTool(`https://www.renpy.org/dl/${sdkVersion}/${fileName}`);
    const extractedRoot = await tc.extractZip(zipPath);

    core.info(`Installing library '${library}' from ${fileName}`);

    const entries = await fs.readdir(extractedRoot);
    // Merge library with renpy
    for (const entry of entries) {
        const src = path.join(extractedRoot, entry);
        await io.cp(src, renpyDir, { recursive: true, force: true });
    }

    await fs.rm(zipPath, { force: true });
    core.info(`Added library '${library}'`);
}


async function setupAndroid(sdkVersion: string) {
    await installLibrary("rapt", sdkVersion)

    await fs.mkdir(path.join(renpyDir, "rapt"), { recursive: true });
    const androidSdkRoot = process.env.ANDROID_SDK_ROOT ?? "";
    await fs.writeFile(path.join(renpyDir, "rapt", "sdk.txt"), `${androidSdkRoot}\n`, "utf8");
}


async function buildTarget(target: string, projectDir: string, destinationDir: string) {
    let args = [renpyLauncher]
    let cleanupWebPath: string | null = null

    switch (target) {
        case "pc":
        case "win":
        case "mac":
        case "linux":
            args.push("distribute", "--package", target, "--destination", destinationDir, projectDir)
            break;

        case "web":
            const webPath = path.join(destinationDir, "web")
            args.push("web_build", "--destination", webPath, projectDir)
            cleanupWebPath = webPath
            break;

        case "android":
            args.push("android_build", "--destination", destinationDir, projectDir)
            break;

        default:
            args.push("distribute", "--destination", destinationDir, projectDir)
            break;
    }

    core.info(`Building the project for platform '${target}' at '${projectDir}'...`)
    await exec.exec(renpyExec, args)

    if (cleanupWebPath) {
        core.info(`Cleaning up web build artifacts at '${cleanupWebPath}'...`)
        await io.rmRF(cleanupWebPath)
    }
}


async function run(): Promise<void> {
    core.info(`Running on ${process.platform} -> Using ${renpyExec}`)
    try {
        const sdkVersion = core.getInput("sdk-version", { required: true });
        const projectDir = core.getInput("project-dir") || ".";
        const renpySteam = parseBool(core.getInput("renpy-steam") || "false");
        const targetsRaw = core.getInput("targets") || "pc";
        const destDir    = core.getInput("output-dir") || "./dist";

        await checkOldGame(projectDir);

        await installRenpySdk(sdkVersion);

        if (renpySteam) {
            await installLibrary("steam", sdkVersion);
        }

        const targets = parseTargets(targetsRaw);

        // If android is requested, do setup once before building
        if (targets.includes("android")) {
            await setupAndroid(sdkVersion);
        }

        if (targets.includes("web")) {
            await installLibrary("web", sdkVersion);
        }

        for (const target of targets) {
            await buildTarget(target, projectDir, destDir);
        }

        const version = await getProjectVersion(projectDir);
        core.setOutput("version", version);
    } catch (err) {
        core.setFailed(err instanceof Error ? err.message : String(err));
    }
}

run()