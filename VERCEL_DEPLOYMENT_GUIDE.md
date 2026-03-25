# Vercel Deployment Fix Guide

## Problem
The `/api/users` and `/api/campaigns` endpoints return 500 errors on production because:
1. Database tables don't exist (migrations haven't been applied)
2. Environment variables aren't configured on Vercel

## Build Process Fix
- **Removed** `prisma db push` from build script (causes failures if DATABASE_URL not set)
- **Build now only**: Generates Prisma client + builds Next.js
- **Migrations must be**: Run separately with proper credentials

## Required Action: Set Environment Variables on Vercel

**CRITICAL**: Deploy will fail without these. Go to Vercel Dashboard:

1. Click your project: **opspulse-lac**
2. Go to **Settings** → **Environment Variables**
3. Add these three variables:

```
DATABASE_URL=postgresql://postgres.cfnmnptftnnnupxgobkk:Igdbe1xDqx64orBv@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true

NEXTAUTH_URL=https://opspulse-lac.vercel.app

NEXTAUTH_SECRET=opspulse360-secret-key-9f8a7b6c5d4e3f2a
```

**Important Notes**:
- Copy exact values from your `.env` file
- `DATABASE_URL` must use pooler (port 6543, not 5432)
- Apply these to all environments (Production, Preview, Development)

## Deployment Steps

### 1. Commit and Push
```bash
git add package.json
git commit -m "fix: remove DB migration from build, set manual migration workflow"
git push
```
Vercel will auto-deploy. This should succeed now.

### 2. Run Database Migrations (After Environment Variables are set)
Once the deployment succeeds, apply migrations:

#### Option A: From Your Local Machine
```bash
# Make sure you have the same DATABASE_URL set locally
npm run prisma:push
npm run prisma:seed  # Optional: populate test data
```

#### Option B: Using Vercel CLI
```bash
# Install Vercel CLI if you don't have it
npm i -g vercel

# Pull environment variables from Vercel
vercel env pull

# Run migrations with those variables
npm run prisma:push
npm run prisma:seed
```

## Verify Deployment Success

1. **Build succeeds**: Check Vercel Deployments tab - no errors
2. **Database tables created**: Run locally:
   ```bash
   npm run prisma:Studio
   ```
   Should show User, Campaign, and other tables
3. **API endpoints work**: Visit:
   - `https://opspulse-lac.vercel.app/api/users` → Returns 200 with users array
   - `https://opspulse-lac.vercel.app/api/campaigns` → Returns 200 with campaigns array

## Troubleshooting

### Build Still Fails: "Tenant or user not found"
**Cause**: DATABASE_URL not set or incorrect on Vercel

**Fix**:
1. Double-check the DATABASE_URL value matches exactly
2. Vercel → Settings → Environment Variables
3. Redeploy after saving

### API Returns 500 Error
**Cause**: Database tables don't exist yet

**Fix**: Run migrations:
```bash
## Get credentials from Vercel
vercel env pull

## Apply migrations to production DB
npm run prisma:push
```

### Authentication Fails: "FATAL: Tenant or user not found"
**Cause**: Supabase credentials are wrong or user doesn't exist

**Fix**:
1. Log into Supabase dashboard
2. Project Settings → Database → Connection string
3. Copy the connection pooler URL (URI format)
4. Update DATABASE_URL on Vercel with exact string

### Tables Exist but API Still Errors
Check Vercel Function Logs:
1. Go to Vercel Dashboard → Your Deployment
2. Click **Functions** tab
3. Look for `/api/users` or `/api/campaigns`
4. View logs for specific error messages

## Files Modified
- `package.json` - Removed `prisma db push` from build, added `vercel-env` script

## Quick Reference

```bash
# Check environment variables are set
npm run vercel-env

# Manual migration commands
npm run prisma:push    # Apply schema migrations
npm run prisma:seed    # Populate test data
npm run prisma:studio  # Browse database

# Verify locally before deployment
npm run dev            # Start dev server
# Visit http://localhost:3000/api/users
```

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
