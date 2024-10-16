/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0 and the Server Side Public License, v 1; you may not use this file except
 * in compliance with, at your election, the Elastic License 2.0 or the Server
 * Side Public License, v 1.
 */

import { createOASDocument } from '../../create_oas_document';
import { bundleSpecs } from '../bundle_specs';

describe('OpenAPI Bundler - assign a tag', () => {
  it('adds tags when nothing is set', async () => {
    const spec1 = createOASDocument({
      paths: {
        '/api/some_api': {
          get: {
            responses: {
              '200': {
                description: 'Successful response',
                content: {
                  'application/json': {
                    schema: {
                      type: 'string',
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    const spec2 = createOASDocument({
      paths: {
        '/api/another_api': {
          get: {
            responses: {
              '200': {
                description: 'Successful response',
                content: {
                  'application/json': {
                    schema: {
                      type: 'string',
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    const [bundledSpec] = Object.values(
      await bundleSpecs(
        {
          1: spec1,
          2: spec2,
        },
        {
          prototypeDocument: {
            tags: [
              {
                name: 'Some Tag',
                description: 'Some tag description',
              },
              {
                name: 'Another Tag',
                description: 'Another tag description',
              },
            ],
          },
        }
      )
    );

    expect(bundledSpec.paths['/api/some_api']?.get?.tags).toEqual(['Some Tag', 'Another Tag']);
    expect(bundledSpec.paths['/api/another_api']?.get?.tags).toEqual(['Some Tag', 'Another Tag']);
    expect(bundledSpec.tags).toEqual([
      {
        name: 'Some Tag',
        description: 'Some tag description',
      },
      {
        name: 'Another Tag',
        description: 'Another tag description',
      },
    ]);
  });

  it('adds tags to existing tags', async () => {
    const spec1 = createOASDocument({
      paths: {
        '/api/some_api': {
          get: {
            tags: ['Local tag'],
            responses: {
              '200': {
                description: 'Successful response',
                content: {
                  'application/json': {
                    schema: {
                      type: 'string',
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    const spec2 = createOASDocument({
      paths: {
        '/api/another_api': {
          get: {
            tags: ['Global tag'],
            responses: {
              '200': {
                description: 'Successful response',
                content: {
                  'application/json': {
                    schema: {
                      type: 'string',
                    },
                  },
                },
              },
            },
          },
        },
      },
      tags: [{ name: 'Global tag', description: 'Global tag description' }],
    });

    const [bundledSpec] = Object.values(
      await bundleSpecs(
        {
          1: spec1,
          2: spec2,
        },
        {
          prototypeDocument: {
            tags: [
              {
                name: 'Some Tag',
                description: 'Some tag description',
              },
              {
                name: 'Another Tag',
                description: 'Another tag description',
              },
            ],
          },
        }
      )
    );

    expect(bundledSpec.paths['/api/some_api']?.get?.tags).toEqual([
      'Some Tag',
      'Another Tag',
      'Local tag',
    ]);
    expect(bundledSpec.paths['/api/another_api']?.get?.tags).toEqual([
      'Some Tag',
      'Another Tag',
      'Global tag',
    ]);
    expect(bundledSpec.tags).toEqual([
      {
        name: 'Some Tag',
        description: 'Some tag description',
      },
      {
        name: 'Another Tag',
        description: 'Another tag description',
      },
      { name: 'Global tag', description: 'Global tag description' },
    ]);
  });

  it('supports x-displayName', async () => {
    const spec1 = createOASDocument({
      paths: {
        '/api/some_api': {
          get: {
            responses: {
              '200': {
                description: 'Successful response',
                content: {
                  'application/json': {
                    schema: {
                      type: 'string',
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    const spec2 = createOASDocument({
      paths: {
        '/api/another_api': {
          get: {
            responses: {
              '200': {
                description: 'Successful response',
                content: {
                  'application/json': {
                    schema: {
                      type: 'string',
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    const [bundledSpec] = Object.values(
      await bundleSpecs(
        {
          1: spec1,
          2: spec2,
        },
        {
          prototypeDocument: {
            tags: [
              {
                name: 'Some Tag',
                description: 'Some tag description',
                'x-displayName': 'Custom name',
              },
            ],
          },
        }
      )
    );

    expect(bundledSpec.paths['/api/some_api']?.get?.tags).toEqual(['Some Tag']);
    expect(bundledSpec.paths['/api/another_api']?.get?.tags).toEqual(['Some Tag']);
    expect(bundledSpec.tags).toEqual([
      {
        name: 'Some Tag',
        description: 'Some tag description',
        'x-displayName': 'Custom name',
      },
    ]);
  });
});
