'use client';

import { useState, useCallback } from 'react';

export interface PaginationState {
  page: number;
  limit: number;
  total: number;
}

export interface UsePaginationResult {
  pageNumber: number;
  pageSize: number;
  totalPages: number;
  totalItems: number;
  startIndex: number;
  endIndex: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  goToPage: (page: number) => void;
  nextPage: () => void;
  prevPage: () => void;
  setPageSize: (size: number) => void;
}

/**
 * Hook for managing pagination state
 * @param initialPage Starting page (1-indexed)
 * @param initialLimit Items per page
 * @param total Total number of items
 */
export function usePagination(
  initialPage = 1,
  initialLimit = 10,
  total = 0
): UsePaginationResult {
  const [page, setPage] = useState(initialPage);
  const [limit, setLimit] = useState(initialLimit);

  const totalPages = Math.ceil(total / limit);
  const startIndex = (page - 1) * limit;
  const endIndex = Math.min(startIndex + limit, total);

  const goToPage = useCallback((newPage: number) => {
    const validPage = Math.max(1, Math.min(newPage, totalPages));
    setPage(validPage);
  }, [totalPages]);

  const nextPage = useCallback(() => {
    if (page < totalPages) {
      setPage((p) => p + 1);
    }
  }, [page, totalPages]);

  const prevPage = useCallback(() => {
    if (page > 1) {
      setPage((p) => p - 1);
    }
  }, [page]);

  const handleSetPageSize = useCallback((newSize: number) => {
    setLimit(Math.max(1, newSize));
    setPage(1); // Reset to first page when page size changes
  }, []);

  return {
    pageNumber: page,
    pageSize: limit,
    totalPages,
    totalItems: total,
    startIndex,
    endIndex,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
    goToPage,
    nextPage,
    prevPage,
    setPageSize: handleSetPageSize,
  };
}
