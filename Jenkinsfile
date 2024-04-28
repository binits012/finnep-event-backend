pipeline {
    agent any
    stages {
        stage('Build') { 
            steps {
                script {
                    sh 'npm install' 
                    sh 'npm run esbuild' 
                    sh 'cp -r staticPages /opt/deployment/yellowbridge/'
                    sh 'cp -r emailTemplates /opt/deployment/yellowbridge/' 
                    sh 'cp .env  /opt/deployment/yellowbridge/'
                    sh 'cp yellowbridge.min.js  /opt/deployment/yellowbridge/'
                    sh 'cp -r node_modules /opt/deployment/yellowbridge/'
                    sh 'cp package.json /opt/deployment/yellowbridge/'
                    sh 'cd /opt/deployment/yellowbridge/'
                }
                
                
            }
        }
        stage('Stop and Run Instance ') {
            steps {
                sh "pm2 list | grep yellowbridge.min.js | awk '{print $2}' | xargs pm2 kill"
                sh 'pm2 start yellowbridge.min.js'
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