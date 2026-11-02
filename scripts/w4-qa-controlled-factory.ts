// QA-only controlled fixture. This never accesses a PLC or paid provider.
import { fixtureCampaignFactory } from '../src/host/campaign-factory.ts';
import { wonderScope, selectWonderScope } from '../src/host/wonder-scope.ts';
export function createCampaignFactory() {
  const factory = fixtureCampaignFactory({adaptive:true, provider:()=>({ id:'qa-waiting-provider', paid:false, estimatedRequestUsd:0, decide:(_context,signal)=>new Promise((_resolve,reject)=>{ const cancel=()=>reject(new Error('QA provider cancelled')); if(signal.aborted) cancel(); else signal.addEventListener('abort',cancel,{once:true}); }) })});
  return {...factory,id:'qa-controlled-fixture',label:'QA controlled waiting provider · fake connector',scope:wonderScope,async create(context){const categories=selectWonderScope(context.scope,wonderScope); const hosted=await factory.create(context); hosted.runtime.options.categories=categories; return hosted;}};
}
