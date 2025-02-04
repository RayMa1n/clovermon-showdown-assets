import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  unlinkSync,
} from 'fs';
import { join as joinPath } from 'path';
import * as t from 'io-ts';
import { isLeft } from 'fp-ts/Either';
import { exit } from 'process';

const directoryType = t.type({
  extension: t.string,
  required: t.boolean,
  path: t.string,
  ignoredEntities: t.array(t.string),
});

type Directory = t.TypeOf<typeof directoryType>;

const entityDirectoryManifestType = t.type({
  entities: t.array(t.string),
  directories: t.array(directoryType),
});

const assetDirectoryManifestType = t.type({
  entityDirectories: t.array(entityDirectoryManifestType),
});

interface VerificationResponse {
  warnings: string[];
  errors: string[];
}

const verifyDirectory = (
  baseDirectory: string,
  entities: string[],
  directory: Directory,
  deleteUnexpected: boolean,
): VerificationResponse => {
  const { extension, required, path, ignoredEntities } = directory;

  const actualDirectory = joinPath(baseDirectory, path);

  if (!existsSync(actualDirectory)) {
    return {
      errors: [`Directory ${path} does not exist`],
      warnings: [],
    };
  }

  const directoryFiles = readdirSync(actualDirectory).reduce<Record<string, { seen: boolean }>>((directoryFiles, fileName) => {
    if (lstatSync(joinPath(actualDirectory, fileName)).isDirectory()) {
      return directoryFiles;
    }

    return {
      ...directoryFiles,
      [fileName]: { seen: false },
    };
  }, {});

  ignoredEntities.forEach((ignoredEntity) => {
    const fileName = `${ignoredEntity}.${extension}`;

    directoryFiles[fileName] = { seen: true };
  });

  const verificationResponse: VerificationResponse = {
    errors: [],
    warnings: [],
  };

  entities.forEach((entity) => {
    const fileName = `${entity}.${extension}`;

    if (!directoryFiles[fileName]) {
      if (required) {
        verificationResponse.errors.push(`File ${joinPath(path, fileName)} missing`);
      } else {
        verificationResponse.warnings.push(`File ${joinPath(path, fileName)} missing`);
      }
    } else {
      directoryFiles[fileName].seen = true;
    }
  });

  Object.entries(directoryFiles).forEach(([fileName, fileNameStatus]) => {
    if (!fileNameStatus.seen) {
      if (deleteUnexpected) {
        unlinkSync(joinPath(actualDirectory, fileName));
      } else {
        verificationResponse.errors.push(`File ${joinPath(path, fileName)} unexpected`);
      }
    }
  });

  return verificationResponse;
};

const verifyDirectoryManifest = (baseDirectory: string, deleteUnexpected = false): VerificationResponse => {
  if (!existsSync(baseDirectory)) {
    return {
      errors: [`Directory ${baseDirectory} does not exist`],
      warnings: [],
    };
  }

  const manifestFileName = joinPath(baseDirectory, '/manifest.json');

  if (!existsSync(manifestFileName)) {
    return {
      errors: [`Manifest ${manifestFileName} does not exist`],
      warnings: [],
    };
  }

  const manifestFile = JSON.parse(readFileSync(manifestFileName, 'utf8'));

  const manifestResult = assetDirectoryManifestType.decode(manifestFile);

  if (isLeft(manifestResult)) {
    return {
      errors: [`Manifest ${manifestFileName} is malformed`],
      warnings: [],
    };
  }

  const manifest = manifestResult.right;
  const manifestIssues: VerificationResponse = {
    errors: [],
    warnings: [],
  };

  manifest.entityDirectories.forEach((entityDirectory) => {
    entityDirectory.directories.forEach((directory) => {
      const verification = verifyDirectory(baseDirectory, entityDirectory.entities, directory, deleteUnexpected);

      manifestIssues.errors.push(...verification.errors);
      manifestIssues.warnings.push(...verification.warnings);
    });
  });

  return manifestIssues;
};

const args = yargs(hideBin(process.argv))
  .option('directory', { type: 'string', demandOption: true, array: true })
  .option('deleteUnexpected', { type: 'boolean' })
  .option('showWarnings', { type: 'boolean', default: true })
  .option('exitOnError', { type: 'boolean', default: true })
  .parseSync();

let hasError = false;

args.directory.forEach((directory) => {
  const response = verifyDirectoryManifest(directory, args.deleteUnexpected);

  if (response.errors.length) {
    hasError = true;
  }

  response.errors.forEach((error) => console.error(error));

  if (response.warnings) {
    response.warnings.forEach((warning) => console.warn(warning));
  }
});

if (hasError && args.exitOnError) {
  exit(1);
} else {
  exit(0);
}