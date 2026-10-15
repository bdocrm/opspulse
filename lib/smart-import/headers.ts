import type { Field } from "./types";
import { normalizeName } from "./normalization";

const aliases: Record<string, Field> = {
  REMARKS: "sourceRemarks", STATUS: "sourceRemarks", "SOURCE REMARKS": "sourceRemarks", "SPECIAL REMARKS": "sourceRemarks",
  CAMPAIGN: "campaign", "CAMPAIGN NAME": "campaign", ACCOUNT: "campaign", PROGRAM: "campaign",
  "GOAL TYPE": "goalType", KPI: "goalType", "KPI TYPE": "goalType", METRIC: "goalType", "METRIC TYPE": "goalType",
  SEAT: "seat", SEATS: "seat", "SEAT COUNT": "seat", "DECLARED SEAT": "seat",
  GOAL: "target", TARGET: "target", "MONTHLY GOAL": "target", "MONTHLY TARGET": "target",
  MTD: "mtd", ACTUAL: "mtd", "MONTH TO DATE": "mtd", "MONTHLY ACTUAL": "mtd",
  ACHIEVEMENT: "achievement", "ACHIEVEMENT RATE": "achievement", ATTAINMENT: "achievement",
  RR: "runRate", "RUN RATE": "runRate", RUNRATE: "runRate",
  "RR ACHIEVEMENT": "rrAchievement", "RUN RATE ACHIEVEMENT": "rrAchievement",
  WDAYS: "workingDays", "WORKING DAYS": "workingDays", "WORK DAYS": "workingDays",
  "DAYS LAPSED": "daysLapse", "DAYS LAPSE": "daysLapse", "ELAPSED DAYS": "daysLapse",
  DATE: "dateUpdated", "REPORT DATE": "dateUpdated", "DATE UPDATED": "dateUpdated", "AS OF": "dateUpdated",
  "ACCOUNT NAME": "campaign", "PROGRAM NAME": "campaign", "CAMPAIGNS": "campaign",
  "KPI NAME": "goalType", "METRIC NAME": "goalType", "KEY PERFORMANCE INDICATOR": "goalType", "GOALTYPE": "goalType",
  "NO OF SEATS": "seat", "NUMBER OF SEATS": "seat", "HEADCOUNT": "seat",
  "MTD ACTUAL": "mtd", "MTD PRODUCTION": "mtd", "MONTH TO DATE ACTUAL": "mtd",
  "ACHIEVEMENT PERCENTAGE": "achievement", "ACHIEVEMENT PERCENT": "achievement", "ACH": "achievement",
  "RR ACH": "rrAchievement", "RR ACHIEVEMENT PERCENTAGE": "rrAchievement", "RUN RATE ACHIEVEMENT PERCENTAGE": "rrAchievement",
  "TOTAL WORKING DAYS": "workingDays", "DAYS ELAPSED": "daysLapse", "LAST UPDATED": "dateUpdated",
};
export function identifyHeader(header: unknown): Field | null {
  const text = normalizeName(header).replace(/^(?:W|WK|WEEK)\s+(?:NO|NUMBER)\s+/, "WEEK ");
  const week = text.match(/^(?:W|WK|WEEK)\s*0?([1-5])(?:\s+(?:ACTUAL|PRODUCTION))?$/);
  return week ? `week${week[1]}` as Field : aliases[text] ?? null;
}
