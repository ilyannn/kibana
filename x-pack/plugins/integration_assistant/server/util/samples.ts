/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as yaml from 'js-yaml';
import type { CategorizationState, EcsMappingState, RelatedState } from '../types';

interface SampleObj {
  [key: string]: unknown;
}

interface NewObj {
  [key: string]: {
    [key: string]: SampleObj;
  };
}

interface Field {
  name: string;
  type: string;
  fields?: Field[];
}

// Given a graph state, it collects the rawSamples (array of JSON strings) and prefixes them with the packageName and dataStreamName, returning an array of prefixed JSON strings.
export function prefixSamples(
  state: EcsMappingState | CategorizationState | RelatedState
): string[] {
  const modifiedSamples: string[] = [];
  const rawSamples = state.rawSamples;
  const packageName = state.packageName;
  const dataStreamName = state.dataStreamName;

  for (const sample of rawSamples) {
    const sampleObj: SampleObj = JSON.parse(sample);
    const newObj: NewObj = {
      [packageName]: {
        [dataStreamName]: sampleObj,
      },
    };
    const modifiedSample = JSON.stringify(newObj);
    modifiedSamples.push(modifiedSample);
  }

  return modifiedSamples;
}

export function formatSamples(samples: string[]): string {
  const formattedSamples: unknown[] = [];

  for (const sample of samples) {
    const sampleObj = JSON.parse(sample);
    formattedSamples.push(sampleObj);
  }

  return JSON.stringify(formattedSamples, null, 2);
}

function determineType(value: unknown): string {
  if (typeof value === 'object' && value !== null) {
    if (Array.isArray(value)) {
      return 'group';
    }
    return 'group';
  }
  if (typeof value === 'string') {
    return 'keyword';
  }
  if (typeof value === 'boolean') {
    return 'boolean';
  }
  if (typeof value === 'number') {
    return 'long';
  }
  return 'keyword'; // Default type for null or other undetermined types
}

function recursiveParse(obj: unknown, path: string[]): Field {
  if (typeof obj === 'object' && obj !== null) {
    if (Array.isArray(obj)) {
      // Assume list elements are uniform and use the first element as representative
      if (obj.length > 0) {
        return recursiveParse(obj[0], path);
      }
      return { name: path[path.length - 1], type: 'group', fields: [] };
    }
    const fields: Field[] = [];
    for (const [key, value] of Object.entries(obj)) {
      fields.push(recursiveParse(value, path.concat(key)));
    }
    return { name: path[path.length - 1], type: 'group', fields };
  }
  return { name: path[path.length - 1], type: determineType(obj) };
}

export function generateFields(mergedDocs: string): string {
  const ecsTopKeysSet: Set<string> = new Set([
    '@timestamp',
    'agent',
    'as',
    'base',
    'client',
    'cloud',
    'code_signature',
    'container',
    'data_stream',
    'destination',
    'device',
    'dll',
    'dns',
    'ecs',
    'elf',
    'email',
    'error',
    'event',
    'faas',
    'file',
    'geo',
    'group',
    'hash',
    'host',
    'http',
    'interface',
    'labels',
    'log',
    'macho',
    'message',
    'network',
    'observer',
    'orchestrator',
    'organization',
    'os',
    'package',
    'pe',
    'process',
    'registry',
    'related',
    'risk',
    'rule',
    'server',
    'service',
    'source',
    'tags',
    'threat',
    'tls',
    'tracing',
    'url',
    'user',
    'user_agent',
    'vlan',
    'volume',
    'vulnerability',
    'x509',
  ]);

  const doc: SampleObj = JSON.parse(mergedDocs);
  const fieldsStructure: Field[] = Object.keys(doc)
    .filter((key) => !ecsTopKeysSet.has(key))
    .map((key) => recursiveParse(doc[key], [key]));

  return yaml.safeDump(fieldsStructure, { sortKeys: false });
}

function isEmptyValue(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) ||
    (Array.isArray(value) && value.length === 0)
  );
}

/**
 * Merges two arrays for purposes of sampling.
 *
 * This function:
 *   - Combines values in two input arrays.
 *   - Removes duplicates from them.
 *   - Sorts in ascending order.
 *   - Truncates to at most maxArrayLength elements.
 *
 * Properties:
 *   - The function is deterministic, commutative and associative.
 *   - [] is the identity element and the result of merging an array with itself is itself.
 *   - For an arbitrary chain of calls `mergeArrays(mergeArrays(A, B), ..., Z)` the result
 *     is the first `maxArrayLength` unique elements from the sorted union of A...Z.
 *
 * @param target - The target array.
 * @param source - The source array.
 * @returns The resulting array with duplicates removed, sorted, and truncated.
 */
export function mergeArrays(target: any[], source: any[]): any[] {
  const MaxArrayLength = 3;

  // Use Set to remove duplicates and convert back to array
  const uniques = new Set(target);
  source.forEach((item) => uniques.add(item));

  const result = Array.from(uniques);
  result.sort();

  // Take at most maxArrayLength elements
  if (result.length > MaxArrayLength) {
    result.length = MaxArrayLength;
  }
  return result;
}

/**
 * Counts the number of JSON dictionaries among the parameters.
 *
 * @param objs - Inputs of any type.
 * @returns The number of dictionaries among them.
 */
function countDictionaries(...objs: any[]): number {
  return objs.filter((obj) => typeof obj === 'object' && obj !== null && !Array.isArray(obj))
    .length;
}

export function mergeDictionaries(
  target: Record<string, any>,
  source: Record<string, any>
): Record<string, unknown> {
  for (const [key, sourceValue] of Object.entries(source))
    if (!isEmptyValue(sourceValue)) {
      const targetValue = target[key];

      if (isEmptyValue(targetValue)) {
        target[key] = sourceValue;
      } else {
        const dictionaries = countDictionaries(sourceValue, targetValue);

        if (dictionaries === 0) {
          // Box the elementary types then merge as arrays.
          const arrayTargetValue = Array.isArray(targetValue) ? targetValue : [targetValue];
          const arraySourceValue = Array.isArray(sourceValue) ? sourceValue : [sourceValue];
          target[key] = mergeArrays(arrayTargetValue, arraySourceValue);
        }

        if (dictionaries === 1) {
          // Do nothing, as we cannot merge a dictionary with non-dictionary.
        }

        if (dictionaries === 2) {
          target[key] = mergeDictionaries(targetValue, sourceValue);
        }
      }
    }

  return target;
}

export function mergeSamples(objects: any[]): string {
  let result: Record<string, unknown> = {};

  for (const obj of objects) {
    let sample: Record<string, unknown> = obj;
    if (typeof obj === 'string') {
      sample = JSON.parse(obj);
    }
    result = mergeDictionaries(result, sample);
  }

  return JSON.stringify(result, null, 2);
}
