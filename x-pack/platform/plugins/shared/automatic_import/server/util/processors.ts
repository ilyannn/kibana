/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { load } from 'js-yaml';
import { join as joinPath } from 'path';
import { Environment, FileSystemLoader } from 'nunjucks';
import { deepCopy } from './util';
import type { ESProcessorItem, ESProcessorOptions, Pipeline } from '../../common';
import type { KVState, SimplifiedProcessors } from '../types';
import { KVProcessor } from '../processor_types';

/**
 * Retrieves the processor options from the provided Elasticsearch processor item.
 *
 * By definiton, a correctly defined Elasticsearch processor must be an object with a
 * single key-value pair, so this function extracts the value (options) associated with the key.
 *
 * @param processor - Correctly defined Elasticsearch processor item.
 * @returns The options associated with the processor item.
 */
function processorOptions(processor: ESProcessorItem): ESProcessorOptions {
  const key = Object.keys(processor)[0];
  const options = processor[key];
  return options;
}

/**
 * Ensures that each processor's tag is unique within the given array.
 * If a duplicate tag is found, we append a numeric postfix to make it unique.
 *
 * @param processors - An array of processors to update with unique tags.
 */
export function makeTagsUnique(processors: ESProcessorItem[]) {
  const knownTags = new Set<string>();
  for (const processor of processors) {
    const options = processorOptions(processor);
    if (options.tag) {
      let tag = options.tag;

      if (knownTags.has(options.tag)) {
        for (let postfix = 2; knownTags.has(tag); postfix++) {
          tag = `${options.tag} #${postfix}`;
        }
        options.tag = tag;
      }

      knownTags.add(tag);
    }
  }
}

export function combineProcessors(
  initialPipeline: Pipeline,
  processors: SimplifiedProcessors
): Pipeline {
  // Create a deep copy of the initialPipeline to avoid modifying the original input
  const currentPipeline = deepCopy(initialPipeline);
  if (Object.keys(processors?.processors).length === 0) {
    return currentPipeline;
  }
  // Add the new processors right before the last 2 remove processor in the initial pipeline.
  // This is so all the processors if conditions are not accessing possibly removed fields.
  const currentProcessors = currentPipeline.processors;
  const appendProcessors = createAppendProcessors(processors);
  const combinedProcessors = [
    ...currentProcessors.slice(0, -2),
    ...appendProcessors,
    ...currentProcessors.slice(-2),
  ];
  makeTagsUnique(combinedProcessors);
  currentPipeline.processors = combinedProcessors;
  return currentPipeline;
}

// The related and categorization graphs returns a simplified array of append processors.
// This function converts the simplified array to the full ESProcessorItem array.
function createAppendProcessors(processors: SimplifiedProcessors): ESProcessorItem[] {
  const templatesPath = joinPath(__dirname, '../templates/processors');
  const env = new Environment(new FileSystemLoader(templatesPath), {
    autoescape: false,
  });
  const template = env.getTemplate('append.yml.njk');
  const renderedTemplate = template.render({ processors });
  const appendProcessors = load(renderedTemplate) as ESProcessorItem[];
  return appendProcessors;
}

// The kv graph returns a simplified grok processor for header
// This function takes in the grok pattern string and creates the grok processor
export function createGrokProcessor(grokPatterns: string[]): ESProcessorItem {
  const templatesPath = joinPath(__dirname, '../templates/processors');
  const env = new Environment(new FileSystemLoader(templatesPath), {
    autoescape: false,
  });
  const template = env.getTemplate('grok.yml.njk');
  const renderedTemplate = template.render({ grokPatterns });
  const grokProcessor = load(renderedTemplate) as ESProcessorItem;
  return grokProcessor;
}

// The kv graph returns a simplified kv processor for structured body
// This function takes in the kvInput string and creates the kv processor
export function createKVProcessor(kvInput: KVProcessor, state: KVState): ESProcessorItem {
  const templatesPath = joinPath(__dirname, '../templates/processors');
  const env = new Environment(new FileSystemLoader(templatesPath), {
    autoescape: false,
  });
  const template = env.getTemplate('kv.yml.njk');
  if (kvInput.trim_key) {
    kvInput.trim_key = kvInput.trim_key.replace(/\\/g, '\\\\').replace(/['"]/g, '\\$&');
  }

  if (kvInput.trim_value) {
    kvInput.trim_value = kvInput.trim_value.replace(/\\/g, '\\\\').replace(/['"]/g, '\\$&');
  }
  const renderedTemplate = template.render({
    kvInput,
    packageName: state.packageName,
    dataStreamName: state.dataStreamName,
  });
  const kvProcessor = load(renderedTemplate) as ESProcessorItem;
  return kvProcessor;
}

// Processor for the csv input to convert it to JSON.
export function createCSVProcessor(source: string, targets: string[]): ESProcessorItem {
  return {
    csv: {
      field: source,
      target_fields: targets,
      description: 'Parse CSV input',
      tag: 'parse csv',
    },
  };
}

// Trivial processor for the on_failure part of the pipeline.
// Use only if the source of error is not necessary.
export function createPassthroughFailureProcessor(): ESProcessorItem {
  return {
    append: {
      field: 'error.message',
      description: 'Append the error message as-is',
      tag: 'append error message',
      value: '{{{_ingest.on_failure_message}}}',
    },
  };
}

// Processor to remove the message field.
export function createRemoveProcessor(): ESProcessorItem {
  return {
    remove: {
      field: 'message',
      ignore_missing: true,
      description: 'Remove the message field',
      tag: 'remove message field',
    },
  };
}

// Processor to drop the specific values.
// values is a record of key value pairs to match against the fields
// root is the root of the fields to match against
export function createDropProcessor(
  values: Record<string, unknown>,
  prefix: string[],
  tag: string,
  description: string
): ESProcessorItem {
  const prefixExpression = prefix.join('?.');
  const conditions = Object.entries(values)
    .map(([key, value]) => `ctx.${prefixExpression}?.${key} == '${String(value)}'`)
    .join(' && ');

  return {
    drop: {
      if: conditions,
      ignore_failure: true,
      description,
      tag,
    },
  };
}
