'use client';

import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { UsePaginationResult } from '@/hooks/use-pagination';

interface PaginationControlsProps {
  pagination: UsePaginationResult;
  onPageChange?: (page: number) => void;
}

export function PaginationControls({
  pagination,
  onPageChange,
}: PaginationControlsProps) {
  const handlePrev = () => {
    pagination.prevPage();
    onPageChange?.(pagination.pageNumber - 1);
  };

  const handleNext = () => {
    pagination.nextPage();
    onPageChange?.(pagination.pageNumber + 1);
  };

  const handleGoToPage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value);
    if (!isNaN(value)) {
      pagination.goToPage(value);
      onPageChange?.(value);
    }
  };

  return (
    <div className="flex items-center justify-between gap-4 p-4 border-t">
      <div className="text-sm text-muted-foreground">
        Showing {pagination.startIndex + 1} to {pagination.endIndex} of{' '}
        {pagination.totalItems} items
      </div>

      <div className="flex items-center gap-2">
        <Button
          onClick={handlePrev}
          disabled={!pagination.hasPrevPage}
          variant="outline"
          size="sm"
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </Button>

        <div className="flex items-center gap-1 px-2">
          <span className="text-sm">Page</span>
          <input
            type="number"
            min="1"
            max={pagination.totalPages}
            value={pagination.pageNumber}
            onChange={handleGoToPage}
            className="w-12 px-2 py-1 text-sm border rounded text-center"
          />
          <span className="text-sm">of {pagination.totalPages}</span>
        </div>

        <Button
          onClick={handleNext}
          disabled={!pagination.hasNextPage}
          variant="outline"
          size="sm"
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="text-sm text-muted-foreground">
        Page size:{' '}
        <select
          value={pagination.pageSize}
          onChange={(e) => pagination.setPageSize(parseInt(e.target.value))}
          className="ml-1 px-2 py-1 border rounded text-sm bg-background"
        >
          <option value="10">10</option>
          <option value="25">25</option>
          <option value="50">50</option>
          <option value="100">100</option>
        </select>
      </div>
    </div>
  );
}

export default PaginationControls;
