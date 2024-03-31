pipeline {
    agent any
    stages {
        stage('Build') { 
            steps {
                sh 'npm install' 
                sh 'npm run dist'
                sh 'cd /opt/deployment/yellowbridge'
                sh 'rm -fr *.min.js'
                sh 'cp .env /opt/deployment/yellowbridge/'
                sh 'cp dist/yellowbridge*/*  /opt/deployment/yellowbridge/'
            }
        }
        stage('Stop and Run Instance ') {
            steps {
                sh 'pm2 stop 0'
                sh 'pm2 start /opt/deployment/yellowbridge/app.min.js'
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