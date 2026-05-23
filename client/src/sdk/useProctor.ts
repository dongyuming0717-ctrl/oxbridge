import { useContext } from 'react';
import { ProctorContext } from './ProctorProvider';

export function useProctor() {
  const ctx = useContext(ProctorContext);
  if (!ctx) {
    throw new Error('useProctor must be used within <ProctorProvider>');
  }
  return ctx;
}
