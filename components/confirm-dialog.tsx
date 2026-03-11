'use client';

import React, { ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  actionLabel?: string;
  cancelLabel?: string;
  isDangerous?: boolean;
  isLoading?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  actionLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isDangerous = false,
  isLoading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const handleConfirm = async () => {
    await onConfirm();
  };

  return (
    <Dialog open={open} onOpenChange={onCancel}>
      <DialogContent className={isDangerous ? 'border-red-200 dark:border-red-800' : ''}>
        <DialogHeader>
          <div className="flex items-center gap-3">
            {isDangerous && <AlertTriangle className="h-5 w-5 text-red-600" />}
            <DialogTitle>{title}</DialogTitle>
          </div>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2 justify-end mt-6 sm:gap-0">
          <Button onClick={onCancel} variant="outline" disabled={isLoading}>
            {cancelLabel}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isLoading}
            variant={isDangerous ? 'destructive' : 'default'}
          >
            {isLoading ? 'Processing...' : actionLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ConfirmDialog;
