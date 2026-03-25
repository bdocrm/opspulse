# Vercel Deployment Guide - 500 Error Fix

## Problem
The `/api/users` and `/api/campaigns` endpoints were returning 500 errors on the production deployment (opspulse-lac.vercel.app).

## Root Cause
The build process wasn't running database migrations (`prisma db push`), so the database tables didn't exist in the production environment.

## Solution Applied

### 1. Updated Build Process
Changed `package.json` build script to include Prisma migration:
```json
"build": "prisma generate && prisma db push --skip-generate && next build"
```

### 2. Enhanced Error Logging
- Improved Prisma client initialization with connection logging
- Added detailed error messages to API route handlers
- Error logs now include error codes, messages, and timestamps

### 3. Required Environment Variables

Set these in Vercel Project Settings > Environment Variables:

```
DATABASE_URL=postgresql://user:password@host:port/database?pgbouncer=true
NEXTAUTH_URL=https://opspulse-lac.vercel.app
NEXTAUTH_SECRET=your-secure-secret-key
```

**Important**: 
- Use Supabase connection pooler URL (port 6543, not 5432)
- Ensure `NEXTAUTH_URL` matches your Vercel domain
- Generate a secure `NEXTAUTH_SECRET` (min 32 characters recommended)

## Deployment Steps

1. **Commit changes**:
   ```bash
   git add package.json app/api/users/route.ts app/api/campaigns/route.ts lib/prisma.ts
   git commit -m "fix: improve error handling and add DB migrations to build"
   git push
   ```

2. **Verify Environment Variables**:
   - Go to Vercel Dashboard > Your Project > Settings > Environment Variables
   - Ensure `DATABASE_URL` is set to production database
   - Ensure `NEXTAUTH_URL` is set to production domain

3. **Redeploy**:
   - Vercel will automatically redeploy on git push
   - Or manually trigger redeploy from Vercel Dashboard
   - Monitor "Deployments" tab for build progress

4. **Monitor Logs**:
   - Click on the deployment
   - View "Function Logs" tab
   - Look for "[Prisma] Successfully connected to database" message
   - Any errors will show detailed error codes and messages

## Testing After Deployment

1. Open browser Network tab: `F12` > Network
2. Visit: `https://opspulse-lac.vercel.app/api/users`
3. Should return 200 status with user array
4. Visit: `https://opspulse-lac.vercel.app/api/campaigns`
5. Should return 200 status with campaign array

## Troubleshooting

### Still Getting 500 Errors

Check Vercel Function Logs:
1. Go to Vercel Dashboard > Deployments > Latest Deploy
2. Click "Functions" or "Logs" tab
3. Look for error messages with codes (e.g., `P1000` for connection errors)

**Common Errors**:
- `P1000`: Cannot reach database - verify `DATABASE_URL` is correct
- `P1001`: Cannot find install location for `query_engine` - run `npm ci` not `npm install`
- `P1003`: Database does not exist - migrations failed

### Database Connection Timeout

If seeing connection timeout errors:
- Verify Supabase database is running and accessible
- Check IP whitelist on Supabase (should allow all for Vercel)
- Use connection pooler URL (port 6543) not direct connection (port 5432)

### Migrations Failing

If seeing migration errors during build:
1. Run locally: `npx prisma db push --skip-generate`
2. Check for schema conflicts
3. Verify database user has permissions to create tables
4. Review migration output in Vercel logs

## Files Modified

- `package.json` - Build script now includes `prisma db push`
- `app/api/users/route.ts` - Enhanced error logging
- `app/api/campaigns/route.ts` - Enhanced error logging  
- `lib/prisma.ts` - Added connection status logging

## Next Steps

Once deployment is successful:
1. Run data seeder (if needed): `npx prisma db seed`
2. Verify data is present in Vercel via Prisma Studio: `npx prisma studio`
3. Test all API endpoints return data
4. Test user login functionality
