import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { ServerIndex } from '@/utils/predicate';
import type { SearchSchema, ServerEntry } from '@/api/searchSchema';

/**
 * 加载筛选条件 schema 与区服清单。
 *
 * 这两个文件是站点配置的快照（由 cbg-filter-kit 的 tools/ 生成），
 * 放在 public/data/ 下由静态站直接 fetch——藏宝阁改版后重新生成即可，前端不用改。
 */

const SCHEMA_URL = new URL('data/filters.json', document.baseURI).toString();
const SERVERS_URL = new URL('data/servers.json', document.baseURI).toString();

export interface SearchConfig {
  schema: SearchSchema | undefined;
  servers: ServerEntry[];
  serverIndex: ServerIndex;
  isLoading: boolean;
  error: Error | null;
}

export const useSearchConfig = (): SearchConfig => {
  const schemaQuery = useQuery({
    queryKey: ['cbg', 'schema'],
    queryFn: async ({ signal }) => {
      const res = await fetch(SCHEMA_URL, { signal, cache: 'no-cache' });
      if (!res.ok) throw new Error(`筛选条件加载失败：HTTP ${res.status}`);
      return (await res.json()) as SearchSchema;
    },
    staleTime: Infinity, // 站点配置基本不变，一次加载长期有效
    retry: 1,
  });

  const serversQuery = useQuery({
    queryKey: ['cbg', 'servers'],
    queryFn: async ({ signal }) => {
      const res = await fetch(SERVERS_URL, { signal, cache: 'no-cache' });
      if (!res.ok) throw new Error(`区服清单加载失败：HTTP ${res.status}`);
      return (await res.json()) as ServerEntry[];
    },
    staleTime: Infinity,
    retry: 1,
  });

  const servers = serversQuery.data ?? [];
  const serverIndex = useMemo(() => new ServerIndex(servers), [servers]);

  return {
    schema: schemaQuery.data,
    servers,
    serverIndex,
    isLoading: schemaQuery.isLoading || serversQuery.isLoading,
    error:
      (schemaQuery.error as Error | null) ?? (serversQuery.error as Error | null) ?? null,
  };
};
