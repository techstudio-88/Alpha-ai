import test from 'node:test';
import assert from 'node:assert/strict';
import {bootstrapWorkspace} from '../lib/workspace-bootstrap.mjs';

function fixture({owner=false}={}) {
  const writes=[];
  const user={id:'member',email:'fixture@example.com'};
  const workspace={id:'workspace',owner_id:owner?user.id:'other-owner',name:'Existing studio'};
  const admin={from(table){
    const builder={
      select(){return this},eq(){return this},order(){return this},limit(){return this},
      upsert(row,options){writes.push({table,row,options});this.write=true;return this},
      insert(row){writes.push({table,row});this.write=true;return this},
      maybeSingle(){return Promise.resolve({data:table==='workspace_members'?{workspace_id:'workspace',role:owner?'owner':'member'}:table==='workspaces'?workspace:{workspace_id:'workspace'}})},
      then(resolve){return Promise.resolve({data:this.write?null:workspace}).then(resolve)},
    };
    return builder;
  }};
  return {admin,user,workspace,writes};
}
test('existing team member is not promoted and an existing paid plan is not reset',async()=>{
  const f=fixture();assert.equal(await bootstrapWorkspace(f.admin,f.user),f.workspace);
  assert.equal(f.writes.some(w=>w.table==='workspace_members'),false);
  const subscription=f.writes.find(w=>w.table==='subscriptions');
  assert.equal(subscription.options.ignoreDuplicates,true);
  assert.equal(f.writes.some(w=>w.table==='usage'),false);
});
test('repairing an owner membership does not overwrite an existing role',async()=>{
  const f=fixture({owner:true});await bootstrapWorkspace(f.admin,f.user);
  assert.equal(f.writes.find(w=>w.table==='workspace_members').options.ignoreDuplicates,true);
});
