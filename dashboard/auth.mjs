/** Browser auth flow. Provider details, credentials and addresses are never logged. */
const MESSAGES=Object.freeze({
 email_not_confirmed:'Seu e-mail ainda precisa ser confirmado. Confira sua caixa de entrada e spam ou solicite uma nova confirmação.',
 invalid_credentials:'E-mail ou senha não conferem. Use os mesmos dados do cadastro e tente novamente.',
 invalid_login_credentials:'E-mail ou senha não conferem. Use os mesmos dados do cadastro e tente novamente.',
 over_email_send_rate_limit:'O serviço atingiu o limite de e-mails. Aguarde antes de solicitar outra confirmação.',
 over_request_rate_limit:'Muitas tentativas em pouco tempo. Aguarde um momento e tente novamente.',
 email_address_not_authorized:'O envio de confirmação para este endereço ainda não está habilitado no ambiente de teste. A configuração de e-mail precisa ser ajustada.',
 user_already_exists:'Não foi possível concluir o cadastro. Se você já se cadastrou, escolha Entrar e use seus dados.',
 weak_password:'Escolha uma senha mais forte, com pelo menos 8 caracteres.',
 signup_disabled:'Novos cadastros estão temporariamente indisponíveis. Tente entrar se já possui conta.',
});
export function authErrorMessage(error){return Object.hasOwn(MESSAGES,error?.code)?MESSAGES[error.code]:'Não foi possível autenticar agora. Confira os dados e tente novamente.';}
export function authRedirectTarget(input){
 const url=new URL(input);
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new TypeError('Invalid auth redirect origin');
 return url.origin+'/';
}
/** Dependencies expose only deliberate form actions; no automatic email resend. */
export function createAuthController({auth,redirectOrigin,onMode=()=>{},onMessage=()=>{},onPending=()=>{},onClearPassword=()=>{},onAuthenticated=async()=>{}}){
 const redirectTo=authRedirectTarget(redirectOrigin);let signup=false,pendingEmail=null,busy=false;
 function setMode(value){signup=value===true;pendingEmail=null;onPending(false);onMode(signup);}
 async function submit({email,password}){
  if(busy)return false;busy=true;
  const registering=signup;const address=email.trim();pendingEmail=null;onPending(false);
  try{
   const result=registering?await auth.signUp({email:address,password,options:{emailRedirectTo:redirectTo}}):await auth.signInWithPassword({email:address,password});
   if(result.error){
    if(result.error.code==='email_not_confirmed'){pendingEmail=address;onPending(true);}
    onMessage(authErrorMessage(result.error),false);return false;
   }
   onClearPassword();
   if(registering&&!result.data?.session){
    setMode(false);
    onMessage('Solicitação de cadastro recebida. Se houver confirmação pendente, verifique seu e-mail e spam. Se sua conta já estiver confirmada, entre com sua senha.',true);
    return true;
   }
   if(!result.data?.session){onMessage('Não foi possível iniciar sua sessão. Tente entrar novamente.',false);return false;}
   await onAuthenticated();return true;
  }catch{onMessage('Não foi possível conectar ao serviço de acesso. Verifique sua conexão e tente novamente.',false);return false;}
  finally{busy=false;}
 }
 async function resendConfirmation(){
  if(!pendingEmail||busy)return false;busy=true;
  try{
   const result=await auth.resend({type:'signup',email:pendingEmail,options:{emailRedirectTo:redirectTo}});
   if(result.error){onMessage(authErrorMessage(result.error),false);return false;}
   onMessage('Solicitação de confirmação recebida. Se houver confirmação pendente, verifique a caixa de entrada e spam. A entrega depende do serviço de e-mail.',true);return true;
  }catch{onMessage('Não foi possível solicitar a confirmação. Verifique sua conexão e tente novamente.',false);return false;}
  finally{busy=false;}
 }
 return Object.freeze({setMode,toggleMode:()=>setMode(!signup),submit,resendConfirmation});
}

/** Session checks handle network/revocation failures without an unhandled boot promise. */
export async function verifyAuthSession({auth,isCurrent=()=>true,onUser,onMissing,onError,reportFailure=false}){
 try{
  const {data,error}=await auth.getUser();
  if(!isCurrent())return false;
  if(error||!data?.user){onMissing();if(reportFailure)onError('Sua sessão não pôde ser verificada. Tente entrar novamente.');return false;}
  await onUser(data.user);return true;
 }catch{
  if(!isCurrent())return false;
  onMissing();onError('Não foi possível verificar sua sessão. Confira sua conexão e tente entrar novamente.');return false;
 }
}
