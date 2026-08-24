'use client';

import { useEffect } from 'react';
import { getClientLogger } from '../../lib/utils/client-logger';

export function LoggerInitializer(): React.ReactElement {
  useEffect(() => {
    getClientLogger().info('Page loaded');
  }, []);

  return <></>;
}