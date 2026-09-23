import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request){
  try{
    const auth=request.headers.get("authorization")||"";
    const token=auth.replace(/^Bearer\s+/i,"").trim();
    if(!token)return NextResponse.json({error:"Authentication required."},{status:401});
    const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
    if(!url||!serviceKey)return NextResponse.json({error:"Server account deletion is not configured."},{status:503});
    const admin=createClient(url,serviceKey,{auth:{autoRefreshToken:false,persistSession:false}});
    const {data:{user},error}=await admin.auth.getUser(token);
    if(error||!user)return NextResponse.json({error:"Authentication expired."},{status:401});
    const deleted=await admin.auth.admin.deleteUser(user.id);
    if(deleted.error)return NextResponse.json({error:deleted.error.message},{status:500});
    return NextResponse.json({ok:true});
  }catch(error){
    return NextResponse.json({error:error?.message||"Could not delete account."},{status:500});
  }
}