/** Calendar reporting windows shared by tracking and advertising metrics. */
const PERIODS = new Set([0,7,30]);
const formatters = new Map();
const day = 86_400_000;

function formatter(timezone){
  if(typeof timezone!=='string' || timezone.length>100 || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)*$/.test(timezone)){
    throw new Error('Fuso horário de relatório inválido.');
  }
  if(!formatters.has(timezone)){
    try{
      formatters.set(timezone,new Intl.DateTimeFormat('en-CA',{
        timeZone:timezone,calendar:'gregory',numberingSystem:'latn',era:'short',
        year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',
      }));
    }catch{throw new Error('Fuso horário de relatório inválido.');}
  }
  return formatters.get(timezone);
}

function parts(format,time){
  const values=Object.fromEntries(format.formatToParts(new Date(time)).map(part=>[part.type,part.value]));
  const result=Object.fromEntries(['year','month','day','hour','minute','second'].map(key=>[key,Number(values[key])]));
  if(values.era!=='AD' || result.year<1 || result.year>9999)throw new Error('Data de relatório inválida.');
  return result;
}

function civilEpoch(value){
  // Date.UTC interprets years0–99 as1900–1999; setUTCFullYear preserves them.
  const date=new Date(0);
  date.setUTCFullYear(value.year,value.month-1,value.day);
  date.setUTCHours(value.hour||0,value.minute||0,value.second||0,0);
  return date.getTime();
}

const key = value => `${String(value.year).padStart(4,'0')}-${String(value.month).padStart(2,'0')}-${String(value.day).padStart(2,'0')}`;

function firstInstant(format,date){
  const target=civilEpoch(date),targetKey=key(date);
  let guess=target;
  const offsets=new Set();
  // Recompute the offset at the target instant, not at the current date. A
  // reporting window can start on the other side of a daylight-saving change.
  for(let count=0;count<6;count++){
    const local=parts(format,guess),offset=civilEpoch(local)-guess;
    offsets.add(offset);
    const next=target-offset;
    if(next===guess)break;
    guess=next;
  }
  // An autumn transition can repeat midnight. Inspect offsets around the date
  // and choose its first occurrence, rather than dropping the repeated hour.
  for(let hours=-36;hours<=36;hours+=6){
    const sample=target+hours*3_600_000;
    try{offsets.add(civilEpoch(parts(format,sample))-sample);}catch{/* Outside the supported calendar range. */}
  }
  const candidates=[...offsets].map(offset=>target-offset).sort((a,b)=>a-b);
  const exact=candidates.find(time=>{
    const local=parts(format,time);
    return key(local)===targetKey && local.hour===0 && local.minute===0 && local.second===0;
  });
  if(exact!==undefined)return exact;

  // Some zones advance across midnight. Start at the first real instant of
  // that calendar day (for example01:00), without inventing a nonexistent00:00.
  let high=candidates.find(time=>key(parts(format,time))===targetKey);
  if(high===undefined)throw new Error('Início do período indisponível neste fuso.');
  let low=high-2*day;
  while(high-low>1){
    const middle=Math.floor((low+high)/2);
    if(key(parts(format,middle))<targetKey)low=middle;else high=middle;
  }
  if(key(parts(format,high))!==targetKey)throw new Error('Início do período indisponível neste fuso.');
  return high;
}

export function reportingWindow(period,timezone,now=new Date()){
  if(!PERIODS.has(period))throw new Error('Período de relatório inválido.');
  if(!(now instanceof Date) || !Number.isFinite(now.getTime()))throw new Error('Data de relatório inválida.');
  const format=formatter(timezone),today=parts(format,now.getTime());
  const calendar=new Date(civilEpoch({year:today.year,month:today.month,day:today.day}));
  calendar.setUTCDate(calendar.getUTCDate()-(period===0?0:period-1));
  const from={year:calendar.getUTCFullYear(),month:calendar.getUTCMonth()+1,day:calendar.getUTCDate()};
  if(from.year<1 || from.year>9999)throw new Error('Data de relatório inválida.');
  const since=firstInstant(format,from);
  if(since>now.getTime())throw new Error('Data de relatório inválida.');
  return {since:new Date(since).toISOString(),fromDate:key(from),untilDate:key(today)};
}
