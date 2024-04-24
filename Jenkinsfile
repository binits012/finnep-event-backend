pipeline {
    agent any
    stages {
        stage('Build') { 
            steps {
                sh 'npm install' 
                sh 'npm run esbuild'
                if (!fileExists(dir: 'staticPages')) {
                    sh 'mkdir staticPages'
                }
                if (!fileExists(dir: 'emailTemplates')) {
                    sh 'mkdir emailTemplates'
                }
                sh 'cp -r staticPages /opt/deployment/yellowbridge/'
                sh 'cp -r emailTemplates /opt/deployment/yellowbridge/'
                if (!fileExists(dir: 'logs')) {
                    sh 'mkdir logs'
                }
                sh 'cp .env  /opt/deployment/yellowbridge/'
                sh 'cp app.min.js  /opt/deployment/yellowbridge/'
                sh 'cp -r node_modules /opt/deployment/yellowbridge/'
                sh 'cd /opt/deployment/yellowbridge/'
            }
        }
        stage('Stop and Run Instance ') {
            steps {
                sh 'pm2 stop 0'
                sh 'pm2 start app.min.js'
            }
        }
    }
    post {
        always {
            deleteDir()
            dir("${env.WORKSPACE}@tmp") {
                deleteDir()
            }
            dir("${env.WORKSPACE}@script") {
                deleteDir()
            }
            dir("${env.WORKSPACE}@script@tmp") {
                deleteDir()
            }
        }
    }
}