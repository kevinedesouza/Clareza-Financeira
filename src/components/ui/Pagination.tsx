import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export const DEFAULT_PAGE_SIZE = 15;

/** Fatia uma lista em páginas. Página volta para 1 quando o tamanho da lista muda (ex.: filtro). */
export function usePagination<T>(items: readonly T[], pageSize: number = DEFAULT_PAGE_SIZE) {
  const [page, setPage] = useState(1);
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  useEffect(() => {
    setPage(1);
  }, [totalItems]);

  const currentPage = Math.min(page, totalPages);

  const pageItems = useMemo(
    () => items.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [items, currentPage, pageSize]
  );

  return {
    pageItems,
    page: currentPage,
    totalPages,
    totalItems,
    pageSize,
    setPage: (p: number) => setPage(Math.min(Math.max(1, p), totalPages)),
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
          className="focus-ring inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--color-control-border)] disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
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
          className="focus-ring inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--color-control-border)] disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
};
