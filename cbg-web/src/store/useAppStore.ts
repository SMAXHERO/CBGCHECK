import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SearchParams, SelectedCondition } from '@/api/searchSchema';

export type SortDir = 'ascend' | 'descend';
export type ThemeMode = 'dark' | 'light';

interface AppState {
  /** 条件面板编译出来的接口参数，用于对快照做前端过滤 */
  params: SearchParams;
  /** 已选条件的可读摘要（chips / 打印页眉 / 提交记录用） */
  conditions: SelectedCondition[];
  /** 递增即触发条件面板清空（受控组件监听它来重置 selected） */
  resetToken: number;

  /** 深色 / 浅色 */
  theme: ThemeMode;

  /** 勾选的账号 ID，用于底部对比清单 */
  selectedIds: string[];

  setParams: (params: SearchParams, conditions: SelectedCondition[]) => void;
  bumpReset: () => void;
  setTheme: (theme: ThemeMode) => void;
  toggleSelect: (id: string) => void;
  setSelected: (ids: string[]) => void;
  clearSelected: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      params: {},
      conditions: [],
      resetToken: 0,
      theme: 'dark',
      selectedIds: [],

      setParams: (params, conditions) => set({ params, conditions }),
      bumpReset: () => set((s) => ({ resetToken: s.resetToken + 1 })),
      setTheme: (theme) => set({ theme }),

      toggleSelect: (id) =>
        set((s) => ({
          selectedIds: s.selectedIds.includes(id)
            ? s.selectedIds.filter((x) => x !== id)
            : [...s.selectedIds, id],
        })),
      setSelected: (ids) => set({ selectedIds: ids }),
      clearSelected: () => set({ selectedIds: [] }),
    }),
    {
      name: 'cbg-web-state',
      version: 4,
      // 持久化对比清单与主题；筛选条件每次打开从「全部」开始更符合直觉。
      // 注意 conditions 不持久化，所以重载后条件面板是空的、界面显示「全部数据」，
      // 与底部「已选 0 项」一致，不会出现「看着还筛着其实没筛」的错位。
      partialize: (s) => ({ selectedIds: s.selectedIds, theme: s.theme }),
    },
  ),
);
