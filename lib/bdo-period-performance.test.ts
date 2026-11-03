import { describe, expect, it } from 'vitest';
import { resolveBdoPeriodPerformance } from './bdo-period-performance';

describe('BDO period authority',()=>{
  const base={campaignId:'nth',campaignName:'BDO NTH CARD',defaultGoal:380,periods:[{year:2026,month:1},{year:2026,month:6},{year:2026,month:7}],goals:[],dashboard:[],monitoring:[],metrics:[],kpis:[]};
  it('retains early source months when newer monitoring covers only later months',()=>{
    const value=resolveBdoPeriodPerformance({...base,goals:[{campaignId:'nth',year:2026,month:1,monthlyGoal:450}],dashboard:[{campaignId:'nth',year:2026,month:1,recordKind:'ytd',entityName:'',metric:'NTH CARD',monitoringType:null,actual:4515,target:3873,achievement:null}],monitoring:[{campaignId:'nth',reportYear:2026,reportMonth:6,mtd:3774,target:6930}]});
    expect(value.actual).toBe(8289);expect(value.goal).toBe(7380);expect(value.periods).toHaveLength(2);expect(value.periods[0].sourceGoal).toBe(3873);expect(value.unitType).toBe('COUNT');
  });
  it('takes a campaign source control once, instead of adding its agent mirror',()=>{
    const row={campaignId:'nth',year:2026,month:1,entityName:'Agent',metric:'NTH CARD',monitoringType:null,actual:100,target:200,achievement:null};
    const value=resolveBdoPeriodPerformance({...base,dashboard:[{...row,recordKind:'ytd'},{...row,recordKind:'agent_monitoring'}]});
    expect(value.actual).toBe(100);expect(value.goal).toBe(200);
  });
  it('preserves real zero while excluding missing future periods',()=>{
    const value=resolveBdoPeriodPerformance({...base,monitoring:[{campaignId:'nth',reportYear:2026,reportMonth:6,mtd:0,target:100}]});
    expect(value.actual).toBe(0);expect(value.goal).toBe(100);expect(value.periods).toHaveLength(1);
  });
  it('keeps maximum ACVT as percentage points without inventing a count goal',()=>{
    const value=resolveBdoPeriodPerformance({...base,campaignName:'BDO CCC',kpis:[{campaignId:'nth',year:2026,month:1,achievementQa:1.1,achievementAht:1,achievementAdherence:1,achievementCm:1,achievementCd:8.33}]});
    expect(value.actual).toBe(833);expect(value.goal).toBeNull();expect(value.achievement).toBeNull();expect(value.unitType).toBe('PERCENT_POINTS');
  });
});
