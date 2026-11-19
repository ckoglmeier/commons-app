/* eslint-disable @next/next/no-img-element -- ImageResponse renders a PNG; Next Image is not supported in this renderer. */
import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { marketingRoutesEnabled, marketingIndexingEnabled } from '../../../lib/marketing/route-mode';
import { marketingShareContent } from '../../../lib/marketing/share-content';
export const runtime='nodejs';
export async function GET(_request:Request,{params}:{params:Promise<{page:string[]}>}){
 const headers={'X-Robots-Tag':marketingIndexingEnabled()?'index, follow':'noindex, nofollow','Cache-Control':'public, max-age=3600'};
 if(!marketingRoutesEnabled())return new Response(null,{status:404,headers});
 const content=marketingShareContent((await params).page.join('/'));
 if(!content)return new Response(null,{status:404,headers});
 // Only catalog-selected local artwork is read. The URL cannot select a file or remote image.
 const font=await readFile(join(process.cwd(),'public/brand/fonts/Geist-Regular.ttf'));
 const png=await sharp(await readFile(join(process.cwd(),'public',content.artwork.src))).resize(540,420,{fit:'inside'}).png().toBuffer();
 return new ImageResponse(<div style={{display:'flex',width:'100%',height:'100%',background:'white',color:'#16372F',padding:64,fontFamily:'Geist',alignItems:'center'}}><div style={{display:'flex',flexDirection:'column',width:530,paddingRight:24}}><div style={{fontSize:30,marginBottom:40}}>Commons</div><div style={{display:'flex',fontSize:content.title.length>65?42:52,lineHeight:1.14,letterSpacing:-1.5}}>{content.title}</div><div style={{fontSize:24,marginTop:32,color:'#2E6758'}}>Group travel with less group work.</div></div><img alt="" width={510} height={420} style={{objectFit:'contain'}} src={`data:image/png;base64,${png.toString('base64')}`}/></div>,{width:1200,height:630,headers,fonts:[{name:'Geist',data:font,weight:400,style:'normal'}]});
}
