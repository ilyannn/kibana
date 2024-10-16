/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0 and the Server Side Public License, v 1; you may not use this file except
 * in compliance with, at your election, the Elastic License 2.0 or the Server
 * Side Public License, v 1.
 */

import { GenericFtrProviderContext } from '@kbn/test';
import { commonFunctionalServices } from '@kbn/ftr-common-functional-services';
import { services as functionalServces } from '../../services';
import { pageObjects } from '../../page_objects';

const services = {
  ...functionalServces,
  ...commonFunctionalServices,
};

export type FtrProviderContext = GenericFtrProviderContext<typeof services, typeof pageObjects>;
