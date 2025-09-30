"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Database, CheckCircle2, AlertCircle, Loader2 } from "lucide-react"
import { useRSSStore } from "@/lib/store"

export function DatabaseSetup() {
  const [isChecking, setIsChecking] = useState(false)
  const { checkDatabaseStatus, setDatabaseReady } = useRSSStore()

  const handleCheckDatabase = async () => {
    setIsChecking(true)
    try {
      const isReady = await checkDatabaseStatus()
      if (isReady) {
        setDatabaseReady(true)
        // Reload the page to initialize the app
        window.location.reload()
      }
    } catch (error) {
      console.error("Error checking database:", error)
    } finally {
      setIsChecking(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-4">
      <Card className="max-w-2xl w-full">
        <CardHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Database className="w-6 h-6 text-primary" />
            </div>
            <div>
              <CardTitle className="text-2xl">Database Setup Required</CardTitle>
              <CardDescription>Initialize your RSS Reader database to get started</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Your Supabase database needs to be initialized before you can use the RSS Reader. Follow the steps below
              to set up your database.
            </AlertDescription>
          </Alert>

          <div className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-medium flex-shrink-0 mt-0.5">
                  1
                </div>
                <div className="flex-1">
                  <h3 className="font-medium mb-1">Run the Database Script</h3>
                  <p className="text-sm text-muted-foreground mb-3">
                    Click the "Run Script" button below to execute the database initialization script. This will create
                    all necessary tables and indexes.
                  </p>
                  <div className="bg-muted p-3 rounded-md">
                    <code className="text-sm">scripts/001_create_tables.sql</code>
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-medium flex-shrink-0 mt-0.5">
                  2
                </div>
                <div className="flex-1">
                  <h3 className="font-medium mb-1">Verify Database Setup</h3>
                  <p className="text-sm text-muted-foreground">
                    After running the script, click "Check Database" to verify that everything is set up correctly.
                  </p>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t">
              <div className="flex items-center gap-3">
                <Button onClick={handleCheckDatabase} disabled={isChecking} className="flex-1">
                  {isChecking ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Checking Database...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4 mr-2" />
                      Check Database
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>

          <Alert className="bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
            <AlertDescription className="text-sm">
              <strong>Note:</strong> You can find the database script in the Scripts section. The script will create
              tables for folders, feeds, articles, and settings with proper indexes and relationships.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  )
}
