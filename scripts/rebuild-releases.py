#!/usr/bin/env python3
"""Build historical tags in isolated directories and sign with the permanent key.

Passwords are read from an external properties file and passed only in child
process environments. The source checkout, old APKs and Git tags stay intact.
"""

import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import zipfile


REPO = Path(__file__).resolve().parents[1]
TOOLS = REPO.parent / "DeveloperTools"
PACKAGE = "xin.anji.hamlogbook"


def capture(args, cwd=None, env=None):
    return subprocess.check_output(args, cwd=cwd, env=env, text=True,
                                   stderr=subprocess.STDOUT).strip()


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def properties(path):
    # The generated local file uses literal key=value lines, no Java escapes.
    result = {}
    for line in path.read_text().splitlines():
        if line.strip() and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            result[key.strip()] = value.strip()
    for key in ("storeFile", "storePassword", "keyAlias", "keyPassword"):
        if not result.get(key):
            raise ValueError("Incomplete external signing configuration")
    if not Path(result["storeFile"]).is_file():
        raise ValueError("Signing key file does not exist")
    return result


def java_home_for(major, explicit):
    if explicit:
        home = explicit.resolve()
    else:
        portable = sorted((TOOLS / "jdks").glob("*/Contents/Home"))
        home = next((p for p in portable if (p / "release").is_file() and
                     re.search(r'JAVA_VERSION="' + str(major) + r'\.',
                               (p / "release").read_text())), None)
        if home is None:
            home = Path(capture(["/usr/libexec/java_home", "-v", str(major)]))
    version = capture([str(home / "bin" / "java"), "-version"])
    if not re.search(r'version "' + str(major) + r'[.\"]', version):
        raise ValueError("This build requires JDK " + str(major) + " exactly")
    return str(home)


def run(args, cwd, env, log, secrets=()):
    print("Running: " + " ".join(map(str, args)), flush=True)
    with log.open("a") as stream:
        child = subprocess.Popen(list(map(str, args)), cwd=cwd, env=env,
                                 stdout=subprocess.PIPE,
                                 stderr=subprocess.STDOUT, text=True)
        for line in child.stdout:
            for secret in secrets:
                line = line.replace(secret, "[REDACTED]")
            stream.write(line)
            stream.flush()
            print(line, end="", flush=True)
        if child.wait():
            raise RuntimeError("Command failed; see " + str(log))


def build(ref, args, signing, certificate_fingerprint):
    commit = capture(["git", "rev-parse", "--verify", ref + "^{commit}"], REPO)
    metadata = json.loads(capture(["git", "show", commit + ":package.json"], REPO))
    version = metadata["version"]
    if version not in ("1.0.0", "1.1.0"):
        raise ValueError("This historical rebuild script accepts 1.0.0 / 1.1.0 only")
    output = args.output
    output.mkdir(parents=True, exist_ok=True)
    final_apk = output / ("HAM-LogBook-v" + version + "-release.apk")
    if final_apk.exists():
        raise FileExistsError("Refusing to overwrite " + str(final_apk))

    work = REPO / "dist" / ".rebuild-work" / (version + "-" + commit[:12])
    source = work / "source"
    source_zip = output / ("HAM-LogBook-v" + version + "-source.zip")
    if not source.exists():
        work.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "archive", "--format=zip", "--output=" + str(source_zip),
                        commit], cwd=REPO, check=True)
        with zipfile.ZipFile(source_zip) as archive:
            archive.extractall(source)
        (source / "android" / "gradlew").chmod(0o755)
    elif not source_zip.exists():
        raise RuntimeError("Build source exists but its source archive is missing")

    android = source / "android"
    (android / "local.properties").write_text("sdk.dir=" + str(args.sdk) + "\n")
    java_home = java_home_for(17, args.jdk_17) if version == "1.0.0" else java_home_for(21, args.jdk_21)
    env = os.environ.copy()
    # Never let inherited signing variables reach npm or JavaScript tests.
    for key in list(env):
        if key.startswith("HAMLOG_RELEASE_") or key.startswith("HAMLOG_SIGN_"):
            del env[key]
    env.update(JAVA_HOME=java_home, ANDROID_HOME=str(args.sdk),
               ANDROID_SDK_ROOT=str(args.sdk), GRADLE_USER_HOME=str(args.gradle_home))
    log = work / "build.log"
    run(["npm", "ci", "--no-audit", "--no-fund", "--cache", args.npm_cache],
        source, env, log)
    checks = []
    if "test" in metadata.get("scripts", {}):
        run(["npm", "test"], source, env, log)
        checks.append("npm test")
    else:
        for path in sorted((source / "src" / "js").rglob("*.js")):
            run(["node", "--check", path], source, env, log)
        checks.append("node --check src/js/**/*.js (no historical unit tests)")
    run(["npm", "run", "sync"], source, env, log)

    wrapper = (android / "gradle" / "wrapper" / "gradle-wrapper.properties").read_text()
    gradle_version = re.search(r"gradle-([\d.]+)-bin\.zip", wrapper).group(1)
    cached = sorted(args.gradle_home.glob("wrapper/dists/gradle-" + gradle_version +
                                          "-bin/*/gradle-" + gradle_version + "/bin/gradle"))
    gradle = cached[0] if cached else android / "gradlew"
    build_env = env.copy()
    build_env.update(HAMLOG_RELEASE_STORE_FILE=signing["storeFile"],
                     HAMLOG_RELEASE_STORE_PASSWORD=signing["storePassword"],
                     HAMLOG_RELEASE_KEY_ALIAS=signing["keyAlias"],
                     HAMLOG_RELEASE_KEY_PASSWORD=signing["keyPassword"])
    secrets = (signing["storePassword"], signing["keyPassword"])
    gradle_args = [gradle, ":app:assembleRelease", "--no-daemon", "--console=plain"]
    if args.maven_fallback and version == '1.1.0':
        build_env['HAMLOG_BUILD_MAVEN_FALLBACK'] = str(args.maven_fallback.resolve())
        gradle_args.extend(['--init-script', REPO / 'scripts' / 'rebuild-official-artifacts.init.gradle'])
    if args.gradle_offline:
        gradle_args.append("--offline")
    run(gradle_args,
        android, build_env, log, secrets)
    apk_dir = android / "app" / "build" / "outputs" / "apk" / "release"
    built = list(apk_dir.glob("*.apk"))
    if len(built) != 1:
        raise RuntimeError("Expected exactly one Release APK")

    aligned = work / "aligned.apk"
    candidate = work / "signed.apk"
    run([args.build_tools / "zipalign", "-P", "16", "-f", "4", built[0], aligned],
        work, env, log)
    sign_env = env.copy()
    sign_env.update(HAMLOG_SIGN_STORE_PASSWORD=signing["storePassword"],
                    HAMLOG_SIGN_KEY_PASSWORD=signing["keyPassword"])
    signer = args.build_tools / "apksigner"
    run([signer, "sign", "--ks", signing["storeFile"],
         "--ks-key-alias", signing["keyAlias"], "--ks-pass",
         "env:HAMLOG_SIGN_STORE_PASSWORD", "--key-pass", "env:HAMLOG_SIGN_KEY_PASSWORD",
         "--v1-signing-enabled", "true", "--v2-signing-enabled", "true",
         "--v4-signing-enabled", "false", "--out", candidate, aligned],
        work, sign_env, log, secrets)
    verification = capture([str(signer), "verify", "--verbose", "--print-certs",
                            str(candidate)], env=env)
    fingerprint = re.search(r"Signer #1 certificate SHA-256 digest: ([0-9a-fA-F]+)",
                            verification).group(1).lower()
    if fingerprint != certificate_fingerprint:
        raise RuntimeError("Unexpected signing certificate")
    badging = capture([str(args.build_tools / "aapt"), "dump", "badging",
                       str(candidate)], env=env)
    info = re.search(r"package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'",
                     badging).groups()
    expected_code = "10" if version == "1.0.0" else "11"
    if info != (PACKAGE, expected_code, version) or "application-debuggable" in badging:
        raise RuntimeError("Wrong version, package or debuggable APK")
    run([args.build_tools / "zipalign", "-c", "-P", "16", "4", candidate],
        work, env, log)
    checks.extend(["Gradle :app:assembleRelease", "apksigner verify",
                   "certificate matches permanent release key", "APK is not debuggable",
                   "package / versionName / versionCode verified", "zipalign -c -P 16 4"])
    shutil.copyfile(candidate, final_apk)
    record = {
        "built_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "source_ref": ref, "source_commit": commit, "source_modified": False,
        "version_name": version, "version_code": int(expected_code), "package": PACKAGE,
        "min_sdk": int(re.search(r"sdkVersion:'(\d+)'", badging).group(1)),
        "target_sdk": int(re.search(r"targetSdkVersion:'(\d+)'", badging).group(1)),
        "gradle_version": gradle_version,
        "gradle_offline": args.gradle_offline,
        "local_official_maven_fallback": bool(args.maven_fallback and version == '1.1.0'),
        "java_version": capture([str(Path(java_home) / "bin" / "java"), "-version"]),
        "node_version": capture(["node", "--version"]),
        "signing_certificate_sha256": fingerprint, "debuggable": False,
        "apk_file": final_apk.name, "apk_sha256": sha256(final_apk),
        "source_zip_file": source_zip.name, "source_zip_sha256": sha256(source_zip),
        "checks_passed": checks, "device_tests": "Not performed",
        "build_notes": "Historical lockfile; isolated cap sync; external SDK path; "
                       "cached matching Gradle or original wrapper; zipalign and permanent signing."
    }
    (output / ("BUILD-v" + version + ".json")).write_text(
        json.dumps(record, ensure_ascii=False, indent=2) + "\n")
    print("Verified Release APK: " + str(final_apk), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ref", action="append", help="Historical Git ref; repeat for both versions")
    parser.add_argument("--sdk", type=Path, default=TOOLS / "android-sdk")
    parser.add_argument("--gradle-home", type=Path, default=TOOLS / "gradle-home")
    parser.add_argument("--npm-cache", type=Path, default=TOOLS / "npm-cache")
    parser.add_argument("--jdk-17", type=Path, help="JDK 17 Contents/Home directory")
    parser.add_argument("--jdk-21", type=Path, help="JDK 21 Contents/Home directory")
    parser.add_argument("--gradle-offline", action="store_true", help="Use already cached Gradle dependencies")
    local_maven = REPO / 'dist' / '.rebuild-maven-fallback'
    parser.add_argument("--maven-fallback", type=Path,
                        default=local_maven if (local_maven / 'OFFICIAL-ARTIFACTS.json').is_file() else None,
                        help="Local checksum-verified official Google Maven files (auto-detected on this machine)")
    parser.add_argument("--signing-properties", type=Path,
                        default=TOOLS / "ham-logbook-signing" / "keystore.properties")
    parser.add_argument("--certificate", type=Path,
                        default=TOOLS / "ham-logbook-signing" / "ham-logbook-release-certificate.pem")
    parser.add_argument("--output", type=Path,
                        default=REPO / "dist" / ("formal-rebuild-" + datetime.date.today().isoformat()))
    args = parser.parse_args()
    for name in ("sdk", "gradle_home", "npm_cache", "output", "certificate", "signing_properties"):
        setattr(args, name, getattr(args, name).resolve())
    args.build_tools = args.sdk / "build-tools" / "35.0.0"
    if args.maven_fallback:
        artifact_dir = args.maven_fallback / 'com/android/tools/play-sdk-proto/31.13.0'
        records = json.loads((args.maven_fallback / 'OFFICIAL-ARTIFACTS.json').read_text())
        expected_files = {'play-sdk-proto-31.13.0.jar', 'play-sdk-proto-31.13.0.pom'}
        if {r['file'] for r in records} != expected_files:
            raise ValueError('Incomplete official Maven fallback metadata')
        if any(sha256(artifact_dir / r['file']) != r['sha256'] for r in records):
            raise ValueError('Local official artifact checksum mismatch')
    if not (args.build_tools / "apksigner").is_file():
        raise ValueError("Install Android Build Tools 35.0.0 first")
    signing = properties(args.signing_properties)
    fingerprint = capture(["openssl", "x509", "-in", str(args.certificate),
                           "-noout", "-fingerprint", "-sha256"])
    fingerprint = fingerprint.split("=", 1)[1].replace(":", "").lower()
    for ref in args.ref or ["v1.0.0", "v1.1.0"]:
        build(ref, args, signing, fingerprint)
    shutil.copyfile(args.certificate, args.output / args.certificate.name)
    shutil.copyfile(Path(__file__), args.output / "rebuild-releases.py")
    if args.maven_fallback:
        shutil.copyfile(REPO / 'scripts' / 'rebuild-official-artifacts.init.gradle',
                        args.output / 'rebuild-official-artifacts.init.gradle')
        shutil.copyfile(args.maven_fallback / 'OFFICIAL-ARTIFACTS.json',
                        args.output / 'OFFICIAL-ARTIFACTS.json')
    shutil.copyfile(REPO / "docs" / "DEVELOPMENT_GUIDE.md",
                    args.output / "DEVELOPMENT_GUIDE.md")
    files = sorted(p for p in args.output.iterdir() if p.is_file() and p.name != "SHA256SUMS")
    (args.output / "SHA256SUMS").write_text(
        "".join(sha256(p) + "  " + p.name + "\n" for p in files))
    print("Build records and SHA256SUMS: " + str(args.output))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, FileExistsError, subprocess.CalledProcessError) as error:
        # Do not print child-process environment or signing properties.
        print("Build stopped: " + str(error), file=sys.stderr)
        sys.exit(1)
