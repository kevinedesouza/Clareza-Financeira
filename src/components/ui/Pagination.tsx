import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export const DEFAULT_PAGE_SIZE = 15;

const STORAGE_PREFIX = 'clareza-pg:';

function readStoredPage(key?: string): number {
  if (!key) return 1;
  try {
    const v = Number(sessionStorage.getItem(STORAGE_PREFIX + key));
    return Number.isInteger(v) && v >= 1 ? v : 1;
  } catch {
    return 1;
  }
}

/**
 * Fatia uma lista em páginas. Com storageKey, a página atual é lembrada na sessão
 * (sobrevive a recarregamentos da página). A página é ajustada ao limite de páginas disponível.
 */
export function usePagination<T>(items: readonly T[], pageSize: number = DEFAULT_PAGE_SIZE, storageKey?: string) {
  const [page, setPageState] = useState<number>(() => readStoredPage(storageKey));
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(page, totalPages);

  const pageItems = useMemo(
    () => items.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [items, currentPage, pageSize]
  );

  const setPage = (p: number) => {
    const next = Math.min(Math.max(1, p), totalPages);
    setPageState(next);
    if (storageKey) {
      try {
        sessionStorage.setItem(STORAGE_PREFIX + storageKey, String(next));
      } catch {
        /* armazenamento indisponível: a página volta ao início ao recarregar */
      }
    }
  };

  return {
    pageItems,
    page: currentPage,
    totalPages,
    totalItems,
    pageSize,
    setPage,
  };
}

interface PaginationBarProps {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  setPage: (p: number) => void;
  label?: string;
}

export const PaginationBar: React.FC<PaginationBarProps> = ({
  page,
  totalPages,
  totalItems,
  pageSize,
  setPage,
  label = 'itens',
}) => {
  if (totalItems <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalItems);

  return (
    <nav
      aria-label="Paginação"
      className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-text-secondary)]"
    >
      <span>
        {from}–{to} de {totalItems} {label}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setPage(page - 1)}
          disabled={page <= 1}
          aria-label="Página anterior"
          className="focus-ring inline-flex h-10 w-10 md:h-8 md:w-8 items-center justify-center rounded-md border border-[var(--color-control-border)] disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <span className="px-2 font-medium text-[var(--color-text)]">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => setPage(page + 1)}
          disabled={page >= totalPages}
          aria-label="Próxima página"
          className="focus-ring inline-flex h-10 w-10 md:h-8 md:w-8 items-center justify-center rounded-md border border-[var(--color-control-border)] disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
};
