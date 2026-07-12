export const CONSTITUTION_VERSION="3.1" as const
export const CONSTITUTION_UPDATED="2026-07" as const
export * from "@/lib/constants"
export function isBusinessDay(date:Date){const d=date.getDay();return d!==0&&d!==6}
export function nthBusinessDayAfter(from:Date,n:number){const d=new Date(from);let count=0;while(count<n){d.setDate(d.getDate()+1);if(isBusinessDay(d))count++}return d}
export function lastBusinessDayOfMonth(year:number,month:number){const last=new Date(year,month+1,0);while(!isBusinessDay(last))last.setDate(last.getDate()-1);return last}
export interface DealingWindow{contributionDay:Date;opens:Date;closes:Date}
export function getDealingWindow(forDate=new Date()):DealingWindow{const contributionDay=new Date(forDate.getFullYear(),forDate.getMonth(),15);return{contributionDay,opens:nthBusinessDayAfter(contributionDay,3),closes:lastBusinessDayOfMonth(forDate.getFullYear(),forDate.getMonth())}}
export function isInDealingWindow(date=new Date()){const{opens,closes}=getDealingWindow(date);return date>=opens&&date<=closes}
