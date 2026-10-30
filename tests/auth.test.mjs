import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthController,authErrorMessage,authRedirectTarget,verifyAuthSession} from '../dashboard/auth.mjs';
const origin='https://pulso-staging.example.test';
function setup(auth={}){
 const messages=[],modes=[],pending=[],calls=[];let cleared=0,authenticated=0;
 const controller=createAuthController({auth:{signUp:async input=>{calls.push(input);return {data:{session:null}};},...auth},redirectOrigin:origin,onMode:value=>modes.push(value),onMessage:(message,ok)=>messages.push({message,ok}),onPending:value=>pending.push(value),onClearPassword:()=>{cleared++;},onAuthenticated:async()=>{authenticated++;}});
 return {controller,messages,modes,pending,calls,get cleared(){return cleared;},get authenticated(){return authenticated;}};
}
test('ambiguous signup switches to login and never claims delivery or account creation',async()=>{
 const s=setup();s.controller.setMode(true);
 assert.equal(await s.controller.submit({email:' person@example.test ',password:'synthetic-only'}),true);
 assert.equal(s.calls[0].email,'person@example.test');assert.equal(s.calls[0].options.emailRedirectTo,origin+'/');
 assert.equal(s.modes.at(-1),false);assert.equal(s.cleared,1);assert.equal(s.authenticated,0);
 assert.match(s.messages.at(-1).message,/Se houver confirmação pendente/);
 assert.doesNotMatch(s.messages.at(-1).message,/Conta criada|e-mail enviado|enviamos/i);
});
test('signup already confirmed and password sign-in both initialize the authenticated app',async()=>{
 const s=setup({signUp:async()=>({data:{session:{access_token:'synthetic'}}}),signInWithPassword:async()=>({data:{session:{access_token:'synthetic'}}})});
 s.controller.setMode(true);assert.equal(await s.controller.submit({email:'person@example.test',password:'synthetic-only'}),true);
 s.controller.setMode(false);assert.equal(await s.controller.submit({email:'person@example.test',password:'synthetic-only'}),true);
 assert.equal(s.authenticated,2);
});
test('wrong credentials, pending verification and rate limits get specific safe messages',async()=>{
 for(const code of ['invalid_credentials','invalid_login_credentials','email_not_confirmed','over_email_send_rate_limit','over_request_rate_limit','email_address_not_authorized','user_already_exists']){
  const s=setup({signInWithPassword:async()=>({error:{code,message:'private provider details'}})});
  assert.equal(await s.controller.submit({email:'person@example.test',password:'synthetic-only'}),false);
  assert.ok(!s.messages.at(-1).message.includes('private provider'));
  assert.equal(s.pending.at(-1),code==='email_not_confirmed');
  assert.equal(s.authenticated,0);
 }
 assert.match(authErrorMessage({code:'over_email_send_rate_limit'}),/limite de e-mails/);
 assert.match(authErrorMessage({code:'email_not_confirmed'}),/ainda precisa/);
 assert.equal(authErrorMessage({code:'constructor',message:'private'}),authErrorMessage({}));
});
test('resend only happens after pending error and deliberate action; acknowledgement does not promise delivery',async()=>{
 let resends=0;
 const s=setup({signInWithPassword:async()=>({error:{code:'email_not_confirmed'}}),resend:async input=>{resends++;assert.equal(input.type,'signup');assert.equal(input.email,'person@example.test');assert.equal(input.options.emailRedirectTo,origin+'/');return {data:{}};}});
 assert.equal(await s.controller.resendConfirmation(),false);assert.equal(resends,0);
 await s.controller.submit({email:'person@example.test',password:'synthetic-only'});assert.equal(resends,0);
 assert.equal(await s.controller.resendConfirmation(),true);assert.equal(resends,1);
 assert.match(s.messages.at(-1).message,/entrega depende/);
 s.controller.setMode(true);assert.equal(await s.controller.resendConfirmation(),false);assert.equal(resends,1);
});
test('resend and network errors are handled without exposing provider messages',async()=>{
 const s=setup({signInWithPassword:async()=>({error:{code:'email_not_confirmed'}}),resend:async()=>({error:{code:'over_email_send_rate_limit',message:'secret provider'}})});
 await s.controller.submit({email:'person@example.test',password:'synthetic-only'});
 assert.equal(await s.controller.resendConfirmation(),false);assert.match(s.messages.at(-1).message,/limite de e-mails/);assert.ok(!s.messages.at(-1).message.includes('secret'));
 const offline=setup({signInWithPassword:async()=>{throw Error('private network details');}});
 assert.equal(await offline.controller.submit({email:'person@example.test',password:'synthetic-only'}),false);assert.match(offline.messages.at(-1).message,/conectar ao serviço/);
});
test('auth redirects use only an HTTPS browser origin root',()=>{
 assert.equal(authRedirectTarget(origin),origin+'/');
 for(const invalid of ['http://example.test','https://user:secret@example.test/','https://example.test/?token=private','https://example.test/callback','https://example.test/#private'])assert.throws(()=>authRedirectTarget(invalid));
});
test('initial and post-login session failures are visible without unhandled errors or stale UI updates',async()=>{
 const messages=[];let missing=0,ready=0;
 const options={onMissing:()=>{missing++;},onUser:()=>{ready++;},onError:message=>messages.push(message)};
 assert.equal(await verifyAuthSession({...options,auth:{getUser:async()=>{throw Error('private network');}}}),false);
 assert.equal(missing,1);assert.match(messages[0],/verificar sua sessão/);assert.equal(ready,0);
 assert.equal(await verifyAuthSession({...options,reportFailure:true,auth:{getUser:async()=>({data:{user:null},error:{code:'session_not_found'}})}}),false);
 assert.equal(missing,2);assert.match(messages.at(-1),/sessão não pôde/);
 assert.equal(await verifyAuthSession({...options,isCurrent:()=>false,auth:{getUser:async()=>({data:{user:{id:'synthetic'}}})}}),false);assert.equal(ready,0);
 assert.equal(await verifyAuthSession({...options,auth:{getUser:async()=>({data:{user:{id:'synthetic'}}})}}),true);assert.equal(ready,1);
});
