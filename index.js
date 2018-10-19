const fse = require('fs-extra');
const path = require('path');
const fs = require('fs');
const readdirSync = require('recursive-readdir-sync');
const arrayDiff = require('simple-array-diff');
const ora = require('ora');

const ensurePackageJson = (packageJsonFilePath, contentObj) => {
    if (!fs.existsSync(packageJsonFilePath)) {
        fse.ensureFileSync(packageJsonFilePath);

        fs.writeFileSync(packageJsonFilePath, JSON.stringify(contentObj));
    }
};

const isPackageOutdate = ({ packageName, targetFolder, registry }) => {
    const packagejsonFilePath = path.join(targetFolder, `node_modules/${packageName}/package.json`);

    if (!fs.existsSync(packagejsonFilePath)) {
        return true;
    }

    const getNpmPackageVersion = require('get-npm-package-version');
    const currentVersion = JSON.parse(fs.readFileSync(packagejsonFilePath).toString()).version;
    const latestVersion = getNpmPackageVersion(packageName, { registry, timeout: 2000 });

    if (latestVersion) {
        if (currentVersion !== latestVersion) {
            // console.log(`\npackage ${packageName} is outdated, details as below:\n`);
            // console.log('  - packageName: ', packageName);
            // console.log('  - currentVersion: ', currentVersion);
            // console.log('  - hopedVersion: ', latestVersion, '\n');
            return true;
        }
        return false;
    }

    return false;
};

const diffDependencies = (srcPackageFolder, targetPackageFolder) => {
    const _getDependencesVersion = (packageJson, packageLockJson) => {
        let dependencies = {
            type: 'update',
            map: {}
        };

        if (!fs.existsSync(packageJson) || !fs.existsSync(packageLockJson)) {
            dependencies.type = 'package-file-not-exists';
            return dependencies;
        }
        const packageJsonObj = JSON.parse(fs.readFileSync(packageJson, 'utf-8'));
        const packageLockJsonObj = JSON.parse(fs.readFileSync(packageLockJson, 'utf-8'));
        const depReg = /dependenc/i;

        // 找到 package.json 的各个依赖，不写版本号
        const { map } = dependencies;
        for (let key in packageJsonObj) {
            if (depReg.test(key)) {
                for (let dep in packageJsonObj[key]) {
                    if (!map[dep]) {
                        map[dep] = {
                            version: packageJsonObj[key][dep]
                        };
                    }
                }
            }
        }

        // 遍历 packageLockJsonObj，找到各个依赖的版本号
        for (let key in packageLockJsonObj) {
            if (depReg.test(key)) {
                for (let dep in packageLockJsonObj[key]) {
                    if (map[dep]) { // 如果在 package.json 中
                        map[dep].version = packageLockJsonObj[key][dep].version;
                    }
                }
            }
        }

        return dependencies;
    };

    const _diffDependencies = (srcDependencies, targetDependencies) => {
        const added = [];
        const removed = [];
        const common = [];

        const srcMap = srcDependencies.map;
        const targetMap = targetDependencies.map;

        if (targetDependencies.type === 'package-file-not-exists') {
            for (let key in srcMap) {
                added.push(`${key}@${srcMap[key].version}`);
            }
        } else {
            // 遍历源依赖
            for (let key in srcMap) {
                if (targetMap[key]) { // 如果旧依赖
                    if (targetMap[key].version == srcMap[key].version) { // 如果二者依赖版本一致
                        common.push(`${key}@${srcMap[key].version}`);
                    } else { // 如果二者版本不一致
                        added.push(`${key}@${srcMap[key].version}`);
                    }
                } else { // 如果旧依赖不存在
                    added.push(key);
                }
            }

            // 遍历旧依赖
            for (let key in targetMap) {
                if (!srcMap[key]) { // 如果新依赖不存在，说明需要删除
                    removed.push(key);
                }
            }
        }

        return {
            added,
            removed,
            type: targetDependencies.type
        };
    };

    if (!fs.existsSync(path.join(srcPackageFolder, '.package.json')) || !fs.existsSync(path.join(srcPackageFolder, '.package-lock.json'))) {
        throw Error('\n\n.package.json and .package-lock.json file needed!\n\n'.red);
    }

    const srcDependencies = _getDependencesVersion(path.join(srcPackageFolder, '.package.json'), path.join(srcPackageFolder, '.package-lock.json'));
    const targetDependencies = _getDependencesVersion(path.join(targetPackageFolder, 'package.json'), path.join(targetPackageFolder, 'package-lock.json'));

    // 找到有变化的依赖
    return _diffDependencies(srcDependencies, targetDependencies);
};

const replacePackageFiles = (srcPackageFolder, targetPackageFolder) => {
    const filterFiles = (files, rootPath) => {
        return files.map(filePath => {
            const relativePath = filePath.replace(rootPath, '');
            if (relativePath && !/(node_modules\/)|(\.git\/)/.test(relativePath)) {
                return relativePath;
            }
        });
    };
    const srcPackageFiles = filterFiles(readdirSync(srcPackageFolder), srcPackageFolder);
    const targetPackageFiles = filterFiles(readdirSync(targetPackageFolder), targetPackageFolder);

    const diffResult = arrayDiff(targetPackageFiles, srcPackageFiles);

    for (let type in diffResult) {
        const subArr = diffResult[type];
        switch (type) {
            case 'added':
            case 'common':
                subArr.forEach(relativePath => {
                    if (relativePath) {
                        if (/^(\/package\.json)|(\/package-lock\.json)/.test(relativePath)) {
                            return;
                        }

                        const srcFile = path.join(srcPackageFolder, relativePath);
                        let targetFile = path.join(targetPackageFolder, relativePath);

                        if (/^(\/\.package\.json)|(\/\.package-lock\.json)/.test(relativePath)) {
                            targetFile = path.join(targetPackageFolder, relativePath.replace('.package', 'package'));
                        }

                        fse.ensureFileSync(targetFile);
                        fse.copyFileSync(srcFile, targetFile);
                    }
                });
                break;
            case 'removed':
                subArr.forEach(relativePath => {
                    // 删除过程中，对 package.json / package-lock.json 特殊对待，跳过删除 package.json / package-lock.json
                    if (relativePath) {
                        if (/^(\/package\.json)|(\/package-lock\.json)/.test(relativePath)) {
                            return;
                        }

                        const targetFile = path.join(targetPackageFolder, relativePath);

                        if (fs.existsSync(targetFile)) {
                            fse.removeSync(targetFile);
                        }
                    }
                });
                break;
        }
    }
};

const patchPackage = ({ packageName, cacheFolder, targetFolder, registry }) => {
    const srcPackageFolder = path.join(cacheFolder, 'node_modules', packageName);
    const srcPackageDep = path.join(cacheFolder, 'node_modules');
    const targetPackageFolder = path.join(targetFolder, 'node_modules', packageName);

    if (!fs.existsSync(srcPackageFolder) || !fs.existsSync(srcPackageDep)) {
        return;
    }

    // 找到有变化的依赖
    const diffResult = diffDependencies(srcPackageFolder, targetPackageFolder);

    fse.ensureDirSync(targetPackageFolder);

    // 替换文件
    replacePackageFiles(srcPackageFolder, targetPackageFolder);

    if (diffResult.type === 'package-file-not-exists') {
        const spinner = ora(`installing ${packageName}...`).start();
        require('child_process').execSync(`cd ${targetPackageFolder} && npm i --registry ${registry} --silent`);
        spinner.succeed(`${packageName} installed!`).stop();
    } else {
        const spinner = ora(`updating ${packageName}...`).start();
        if (diffResult.added.length) {
            require('child_process').execSync(`cd ${targetPackageFolder} && npm i ${diffResult.added.join(' ')} --registry ${registry} --save --silent`);
        }
        if (diffResult.removed.length) {
            require('child_process').execSync(`cd ${targetPackageFolder} && npm uninstall ${diffResult.removed.join(' ')} --save`);
        }
        spinner.succeed(`${packageName} updated!`).stop();
    }
};

const installPackageWithoutOptional = ({ packageName, cacheFolder, targetFolder, registry, callback }) => {
    const child = require('child_process');

    ensurePackageJson(path.join(targetFolder, 'package.json'), {
        "name": `"install-${packageName}"`,
        "version": "1.0.0"
    });

    try {
        ensurePackageJson(path.join(cacheFolder, 'package.json'), {
            "name": "hot-update-package-cache",
            "version": "1.0.0"
        });
        child.execSync(`cd ${cacheFolder} && npm --registry ${registry} install ${packageName}@latest --no-optional --silent`);

        patchPackage({ packageName, cacheFolder, targetFolder, registry });
        callback();
    } catch (err) {
        console.log(err.stack);
        console.log(`\nstop running "npm --registry ${registry} install ${packageName}@latest"\n`.red);
        process.exit(1);
    }
};

module.exports = ({ packageName, cacheFolder, targetFolder, callback = () => {}, registry }) => {
    // install package with only optionalDependencies
    const spinner = ora('Checking update...').start();
    const outdated = isPackageOutdate({ packageName, targetFolder, registry });
    if (outdated) {
        spinner.succeed(`Checking update done! Package is outdated!`).stop();
    } else {
        spinner.succeed(`Checking update done!`).stop();
    }
    if (outdated) {
        installPackageWithoutOptional({ packageName, cacheFolder, targetFolder, registry, callback });
    } else {
        callback();
    }
};
