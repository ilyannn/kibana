/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import AdmZip from 'adm-zip';
import nunjucks from 'nunjucks';
import { getDataPath } from '@kbn/utils';
import { join as joinPath } from 'path';
import { safeDump } from 'js-yaml';
import type { DataStream, Integration } from '../../common';
import { createSync, ensureDirSync, generateUniqueId, removeDirSync } from '../util';
import { createAgentInput } from './agent';
import { createDataStream } from './data_stream';
import { createFieldMapping } from './fields';
import { createPipeline } from './pipeline';

const initialVersion = '1.0.0';
const MaxManifestNestedIndent = 10;

function generatePreamble(data: string | object): string | object {
  return { a: { b: data } };
}

const DumpStringOptions = { indent: MaxManifestNestedIndent + 2, quotingType: '"' };
const DumpStringPreamble = generatePreamble('c');
const DumpStringRenderedPreamble = safeDump(DumpStringPreamble, DumpStringOptions).replace(
  /c\n$/,
  ''
);

/**
 * Renders a string to YAML format.
 *
 * This function takes a string input and returns a YAML representation of the input, including
 * strings containing special characters or multiline strings. The result is unambigously a YAML
 * string, using quotes as necessary for special characters and cases, e.g.:
 *
 *   renderYAMLString('string') => string
 *   renderYAMLString('1') => "1"
 *   renderYAMLString('a\tb') => "a\tb"
 *
 * The YAML representation can be used in the folowing context, **provided** that the indent
 * of the field `key` does not exceed the `MaxManifestNestedIndent` value:
 *
 * ```
 * start:
 * // ... some keys omitted ...
 *       key: {{ renderYAMLString(input) }}
 * ^^^^^^ // this must be less than `MaxManifestNestedIndent` spaces
 * ```
 *
 * @param input - The string to be dumped to YAML format.
 * @returns The YAML representation of the input string.
 */
export function renderYAMLString(input: string): string {
  const dumped = safeDump(generatePreamble(input), DumpStringOptions).replace(/\n$/, '');

  if (dumped.startsWith(DumpStringRenderedPreamble)) {
    return dumped.slice(DumpStringRenderedPreamble.length);
  } else {
    return '';
  }
}

/**
 * Configures the Nunjucks templating engine.
 *
 * This function sets up the template directories and configuration options for Nunjucks.
 * It configures the template directories for agent, manifest, and system tests.
 */
export function configureNunjucks() {
  const templateDir = joinPath(__dirname, '../templates');
  const agentTemplates = joinPath(templateDir, 'agent');
  const manifestTemplates = joinPath(templateDir, 'manifest');
  const systemTestTemplates = joinPath(templateDir, 'system_tests');
  nunjucks.configure([templateDir, agentTemplates, manifestTemplates, systemTestTemplates], {
    autoescape: false,
  });
}

export async function buildPackage(integration: Integration): Promise<Buffer> {
  configureNunjucks();

  const workingDir = joinPath(getDataPath(), `integration-assistant-${generateUniqueId()}`);
  const packageDirectoryName = `${integration.name}-${initialVersion}`;
  const packageDir = createDirectories(workingDir, integration, packageDirectoryName);

  const dataStreamsDir = joinPath(packageDir, 'data_stream');

  for (const dataStream of integration.dataStreams) {
    const dataStreamName = dataStream.name;
    const specificDataStreamDir = joinPath(dataStreamsDir, dataStreamName);

    createDataStream(integration.name, specificDataStreamDir, dataStream);
    createAgentInput(specificDataStreamDir, dataStream.inputTypes);
    createPipeline(specificDataStreamDir, dataStream.pipeline);
    createFieldMapping(integration.name, dataStreamName, specificDataStreamDir, dataStream.docs);
  }

  const zipBuffer = await createZipArchive(workingDir, packageDirectoryName);

  removeDirSync(workingDir);
  return zipBuffer;
}

function createDirectories(
  workingDir: string,
  integration: Integration,
  packageDirectoryName: string
): string {
  const packageDir = joinPath(workingDir, packageDirectoryName);
  ensureDirSync(workingDir);
  ensureDirSync(packageDir);
  createPackage(packageDir, integration);
  return packageDir;
}

function createPackage(packageDir: string, integration: Integration): void {
  createReadme(packageDir, integration);
  createChangelog(packageDir);
  createBuildFile(packageDir);
  createPackageManifest(packageDir, integration);
  //  Skipping creation of system tests temporarily for custom package generation
  //  createPackageSystemTests(packageDir, integration);
  if (integration?.logo !== undefined) {
    createLogo(packageDir, integration.logo);
  }
}

function createLogo(packageDir: string, logo: string): void {
  const logoDir = joinPath(packageDir, 'img');
  ensureDirSync(logoDir);

  const buffer = Buffer.from(logo, 'base64');
  createSync(joinPath(logoDir, 'logo.svg'), buffer);
}

function createBuildFile(packageDir: string): void {
  const buildFile = nunjucks.render('build.yml.njk', { ecs_version: '8.11.0' });
  const buildDir = joinPath(packageDir, '_dev/build');

  ensureDirSync(buildDir);
  createSync(joinPath(buildDir, 'build.yml'), buildFile);
}

function createChangelog(packageDir: string): void {
  const changelogTemplate = nunjucks.render('changelog.yml.njk', {
    initial_version: renderYAMLString(initialVersion),
  });

  createSync(joinPath(packageDir, 'changelog.yml'), changelogTemplate);
}

function createReadme(packageDir: string, integration: Integration) {
  const readmeDirPath = joinPath(packageDir, '_dev/build/docs/');
  ensureDirSync(readmeDirPath);
  const readmeTemplate = nunjucks.render('package_readme.md.njk', {
    package_name: renderYAMLString(integration.name),
    data_streams: integration.dataStreams,
  });

  createSync(joinPath(readmeDirPath, 'README.md'), readmeTemplate);
}

async function createZipArchive(workingDir: string, packageDirectoryName: string): Promise<Buffer> {
  const tmpPackageDir = joinPath(workingDir, packageDirectoryName);
  const zip = new AdmZip();
  zip.addLocalFolder(tmpPackageDir, packageDirectoryName);
  const buffer = zip.toBuffer();
  return buffer;
}

export function preparePackageManifest(integration: Integration): string {
  const uniqueInputs: { [key: string]: { type: string; title: string; description: string } } = {};

  integration.dataStreams.forEach((dataStream: DataStream) => {
    dataStream.inputTypes.forEach((inputType: string) => {
      if (!uniqueInputs[inputType]) {
        uniqueInputs[inputType] = {
          type: renderYAMLString(inputType),
          title: renderYAMLString(`${dataStream.title} : ${inputType}`),
          description: renderYAMLString(dataStream.description),
        };
      }
    });
  });

  const uniqueInputsList = Object.values(uniqueInputs);

  return nunjucks.render('package_manifest.yml.njk', {
    format_version: '3.1.4',
    package_title: renderYAMLString(integration.title),
    package_name: renderYAMLString(integration.name),
    package_version: renderYAMLString(initialVersion),
    package_description: renderYAMLString(integration.description),
    package_logo: renderYAMLString(integration.logo ?? ''),
    package_logo_title: renderYAMLString(`${integration.name} Logo`),
    package_owner: '@elastic/custom-integrations',
    min_version: renderYAMLString('^8.13.0'),
    inputs: uniqueInputsList,
  });
}

export function createPackageManifest(packageDir: string, integration: Integration): void {
  createSync(joinPath(packageDir, 'manifest.yml'), preparePackageManifest(integration));
}
