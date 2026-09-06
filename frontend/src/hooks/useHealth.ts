import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { HealthData } from '@/lib/api/types';

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => api.get<HealthData>('/health'),
    retry: false,
  });
}
