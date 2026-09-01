"use client";

// Global MTD / report-period context. Lifts the shared year + month selection
// out of individual pages so the chosen reporting period persists across page
// navigation instead of resetting on every route change.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type ReportPeriodSelection = {
  year: number;
  month: number;
  allMonths: boolean;
};

interface ReportPeriodContextValue extends ReportPeriodSelection {
  setPeriod: (year: number, month: number, allMonths: boolean) => void;
  resetPeriod: () => void;
}

const DEFAULT_YEAR = new Date().getFullYear();
const DEFAULT_MONTH = new Date().getMonth() + 1;

const ReportPeriodContext = createContext<ReportPeriodContextValue | undefined>(undefined);

export function ReportPeriodProvider({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<ReportPeriodSelection>({
    year: DEFAULT_YEAR,
    month: DEFAULT_MONTH,
    allMonths: true,
  });

  const setPeriod = useCallback((year: number, month: number, allMonths: boolean) => {
    setSelection({
      year: Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : DEFAULT_YEAR,
      month: Number.isInteger(month) && month >= 1 && month <= 12 ? month : DEFAULT_MONTH,
      allMonths: Boolean(allMonths),
    });
  }, []);

  const resetPeriod = useCallback(() => {
    setSelection({ year: DEFAULT_YEAR, month: DEFAULT_MONTH, allMonths: true });
  }, []);

  const value = useMemo<ReportPeriodContextValue>(
    () => ({ ...selection, setPeriod, resetPeriod }),
    [selection, setPeriod, resetPeriod]
  );

  return <ReportPeriodContext.Provider value={value}>{children}</ReportPeriodContext.Provider>;
}

export function useReportPeriod(): ReportPeriodContextValue {
  const context = useContext(ReportPeriodContext);
  if (!context) {
    throw new Error("useReportPeriod must be used within a ReportPeriodProvider");
  }
  return context;
}
