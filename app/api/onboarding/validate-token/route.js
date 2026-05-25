import { NextResponse } from 'next/server'
import { validateOnboardingToken } from '@/lib/onboardingToken'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const result = await validateOnboardingToken(searchParams.get('token'))
  const status = result.error === 'Server error' ? 500 : 200
  return NextResponse.json(result, { status })
}
