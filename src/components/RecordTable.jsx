import { Fragment, useId, useState } from 'react';
import { Empty } from './Common';

// Presentation only: callers supply cells from authoritative records in API order.
export default function RecordTable({label,columns,rows=[],rowKey=row=>row._id??row.eventId,details,onOpen,detailLabel='Details',empty='No records found.'}){
  const [expanded,setExpanded]=useState(null),id=useId();
  const interactive=!!(details||onOpen);
  function open(row,key){if(onOpen)onOpen(row);else setExpanded(expanded===key?null:key);}
  function rowClick(event,row,key){if(event.target.closest('button,a,input,select,textarea,summary,label'))return;open(row,key);}
  return <div className="table-responsive record-register" role="region" aria-label={label} tabIndex={0}><table className="table table-sm align-middle record-table"><caption className="visually-hidden">{label}</caption><thead><tr>{columns.map(c=><th key={c.key} scope="col" className={c.numeric?'text-end record-number':''}>{c.label}</th>)}{interactive&&<th scope="col"><span className="visually-hidden">Details</span></th>}</tr></thead><tbody>
    {rows.map((row,index)=>{const key=rowKey(row,index),selected=expanded===key,detailId=id+'-'+index;return <Fragment key={key}><tr data-record-id={String(key)} className={interactive?'record-clickable':undefined} onClick={interactive?e=>rowClick(e,row,key):undefined} tabIndex={interactive?0:undefined} aria-expanded={details?selected:undefined} aria-controls={details?detailId:undefined} onKeyDown={interactive?e=>{if(e.target===e.currentTarget&&['Enter',' '].includes(e.key)){e.preventDefault();open(row,key);}}:undefined}>
      {columns.map(c=><td key={c.key} className={c.numeric?'text-end record-number':''}>{c.render?c.render(row):row[c.key]??'Unavailable'}</td>)}
      {interactive&&<td className="record-actions"><button type="button" className="btn btn-sm btn-outline-secondary" aria-expanded={details?selected:undefined} aria-controls={details?detailId:undefined} onClick={()=>open(row,key)}>{typeof detailLabel==='function'?detailLabel(row):detailLabel}</button></td>}
    </tr>{details&&selected&&<tr className="record-detail"><td colSpan={columns.length+1}><div id={detailId}>{details(row)}</div></td></tr>}</Fragment>;})}
    {!rows.length&&<tr><td colSpan={columns.length+(interactive?1:0)}><Empty>{empty}</Empty></td></tr>}
  </tbody></table></div>;
}

export function RecordFacts({items}){
  return <dl className="record-facts">{items.map(([label,value])=><Fragment key={label}><dt>{label}</dt><dd>{value??'Unavailable'}</dd></Fragment>)}</dl>;
}
