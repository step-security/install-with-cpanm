const core = require("@actions/core");
const exec = require("@actions/exec");
const io = require("@actions/io");
const fs = require("fs");
const crypto = require("crypto");

const path = require("path");
const os = require("os");

let PERL;

async function install_cpanm_location() {
  let out = "";

  const options = {};
  options.listeners = {
    stdout: (data) => {
      out += data.toString();
    },
  };

  const p = core.getInput("path");
  await exec.exec(PERL, ["-MConfig", "-e", '$p = $ARGV[0]; $p =~ s/\\$Config\\{(\\w+)\\}/$Config{$1}/g; print $p', "--", p], options);

  return path.resolve(out);
}

async function install_cpanm(install_to) {
  const url = "https://cpanmin.us";

  core.info(`Get cpanm from ${url}`);

  const cpanmScript = path.join(os.tmpdir(), "cpanm");
  await exec.exec("curl", ["-sL", url, "-o", cpanmScript]);

  try {
    const content = fs.readFileSync(cpanmScript, "utf8");
    const versionMatch = content.match(/\$VERSION\s*=\s*['"]([^'"]+)['"]/);
    if (!versionMatch) {
      core.warning("Could not determine cpanm version — skipping integrity verification");
    } else {
      const version = versionMatch[1];
      core.info(`Verifying cpanm ${version} integrity against GitHub`);
      const githubUrl = `https://raw.githubusercontent.com/miyagawa/cpanminus/${version}/cpanm`;
      const cpanmScriptGH = path.join(os.tmpdir(), "cpanm-gh");
      await exec.exec("curl", ["-sfL", githubUrl, "-o", cpanmScriptGH]);
      const sha256 = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
      if (sha256(cpanmScript) !== sha256(cpanmScriptGH)) {
        core.warning("cpanm integrity check failed: SHA256 mismatch between cpanmin.us and GitHub");
      } else {
        core.info("cpanm integrity verified");
      }
    }
  } catch (e) {
    core.warning(`cpanm integrity verification skipped: ${e.message}`);
  }

  core.info(`cpanm Script: ${cpanmScript}`);
  core.info(`install_to ${install_to}`);

  const platform = os.platform();

  if (platform == "win32") {
    await io.cp(cpanmScript, install_to);
  } else {
    await do_exec([
      PERL,
      "-MFile::Copy=cp",
      "-e",
      `cp("${cpanmScript}", "${install_to}"); chmod(0755, "${install_to}")`,
    ]);
  }

  return install_to;
}

async function which_perl() {
  const perl = core.getInput("perl");
  if (perl == "perl") {
    return await io.which("perl", true);
  }
  return perl;
}

function is_true(b) {
  if (b !== null && (b === true || b == "true" || b == "1" || b == "ok")) {
    return true;
  }

  return false;
}

async function do_exec(cmd, env) {
  const sudo = is_true(core.getInput("sudo"));
  const platform = os.platform();
  const [first, ...args] = cmd;
  const bin = sudo && platform != "win32" ? "sudo" : first;
  const rest = sudo && platform != "win32" ? cmd : args;

  const options = env ? { env: { ...process.env, ...env } } : undefined;

  core.info(`do_exec: ${JSON.stringify(bin)} ${JSON.stringify(rest)} ${JSON.stringify(env)}`);

  await exec.exec(bin, rest, options);
}

async function run() {
  PERL = await which_perl();

  const cpanm_location = await install_cpanm_location();

  await install_cpanm(cpanm_location);

  // input arguments
  const install = core.getInput("install");
  const cpanfile = core.getInput("cpanfile");
  const tests = core.getInput("tests");
  const args = core.getInput("args");
  const verbose = core.getInput("verbose");
  const local_lib = core.getInput("local-lib");

  const w_tests = is_true(tests) ? null : "--notest";
  let w_args = [];
  let env = {};
  if (args !== null && args.length) {
    w_args = args.split(/\s+/);
  }

  if (local_lib !== null && local_lib.length) {

    w_args.push("--local-lib", local_lib);
    let perl5lib;
    if ( local_lib.startsWith("~") ) {
      const home = os.homedir();
      perl5lib = local_lib.replace(/^~/, home);
    } else {
      perl5lib = local_lib;
    }
    env = { PERL5LIB: perl5lib };
    core.exportVariable("PERL5LIB", perl5lib);
    core.addPath(path.join(perl5lib, "bin"));
  }

  /* base CMD_install command */
  let CMD_install = [PERL, cpanm_location];

  if (is_true(verbose)) {
    CMD_install.push("-v");
  }

  if (w_tests != null) {
    CMD_install.push(w_tests);
  }

  if (w_args.length) {
    CMD_install = CMD_install.concat(w_args);
  }

  let has_run = false;

  /* install one ore more modules */
  if (install !== null && install.length) {
    // install one or more modules
    core.info(`install: ${install}!`);
    const list = install.split("\n");

    let cmd = [...CMD_install]; /* clone array */
    cmd = cmd.concat(list);

    has_run = true;
    await do_exec(cmd, env);
  }

  /* install from cpanfile */
  if (cpanfile !== null && cpanfile.length) {
    // install one or more modules
    core.info(`cpanfile: ${cpanfile}!`);
    const cpanfile_full_path = path.resolve(cpanfile);
    core.info(`cpanfile: ${cpanfile_full_path}! [resolved]`);

    let cmd = [...CMD_install];
    cmd.push("--cpanfile", cpanfile_full_path, "--installdeps", ".");

    has_run = true;
    await do_exec(cmd, env);
  }

  /* custom run with args */
  if ( has_run === false && w_args.length ) {
    core.info(`custom run with args`);
    let cmd = [...CMD_install];
    await do_exec(cmd, env);
  }

  return;
}

function set_perl(p) {
  PERL = p;
}

function get_perl() {
  return PERL;
}

module.exports = { is_true, do_exec, which_perl, install_cpanm_location, install_cpanm, run, set_perl, get_perl };
